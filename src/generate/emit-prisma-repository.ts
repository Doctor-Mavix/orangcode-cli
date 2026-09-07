import type { Blueprint } from '../blueprint/schema';
import { finderFields, parseOrderedColumn } from '../blueprint/schema';
import type { EntityView, OwnedChildView } from './model';
import {
  PRINT_WIDTH,
  formatImport,
  ownedChildren,
  rootEntity,
  shortEntityName,
  tsType,
} from './model';
import { camelCase, humanize, upperSnakeCase } from './naming';

/**
 * `repositories/sql/<module>.prisma.repository.ts` — the Prisma implementation of the
 * module's repository contract. Owned children ride along as nested writes and includes.
 */
export function emitPrismaRepositoryFile(blueprint: Blueprint): string {
  const root = rootEntity(blueprint);
  const children = ownedChildren(blueprint, root.name);
  const view = repositoryView(blueprint, root, children);

  const sections: string[] = [importSection(blueprint, view)];

  if (view.hasConflict || view.hasNotFound) {
    sections.push(errorCodeSection(view));
  }

  for (const child of children) {
    sections.push(includeConst(child));
  }

  if (children.length > 0) {
    sections.push(detailRowType(root, children));
  }

  for (const child of children) {
    sections.push(rowMapper(entityLines(child), childMapperName(child, root), `${child.name}Row`));
  }

  sections.push(rowMapper(entityLines(root), `to${root.name}`, `${root.name}Row`));

  if (children.length > 0) {
    sections.push(detailMapper(root, children));
  }

  if (view.hasConflict || view.hasNotFound) {
    sections.push(
      [
        'function errorCodeOf(error: unknown): string | undefined {',
        '  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;',
        '}',
      ].join('\n'),
    );
  }

  if (view.hasList) {
    sections.push(cursorWhereSection(root));
  }

  sections.push(classSection(blueprint, view));

  return `${sections.join('\n\n')}\n`;
}

interface RepositoryView {
  root: EntityView;
  children: OwnedChildView[];
  detailType: string;
  /** `toDetail` when children exist, `to<Root>` otherwise. */
  mapper: string;
  /** `this.client.complaint` — the delegate every method goes through. */
  delegate: string;
  uniqueField: string | null;
  hasCreate: boolean;
  hasList: boolean;
  hasUpdate: boolean;
  hasRemove: boolean;
  hasConflict: boolean;
  hasNotFound: boolean;
}

function repositoryView(
  blueprint: Blueprint,
  root: EntityView,
  children: OwnedChildView[],
): RepositoryView {
  const { operations } = blueprint.repository;
  const uniqueField = root.fields.find(([, field]) => field.unique === true)?.[0] ?? null;
  const hasCreate = operations.includes('create');
  const hasUpdate = operations.includes('update');
  const hasRemove = operations.includes('remove');

  return {
    root,
    children,
    detailType: children.length > 0 ? `${root.name}Detail` : root.name,
    mapper: children.length > 0 ? 'toDetail' : `to${root.name}`,
    delegate: `this.client.${camelCase(root.name)}`,
    uniqueField,
    hasCreate,
    hasList: operations.includes('list'),
    hasUpdate,
    hasRemove,
    hasConflict: hasCreate && uniqueField !== null,
    hasNotFound: hasUpdate || hasRemove,
  };
}

function childMapperName(child: OwnedChildView, root: EntityView): string {
  return `to${shortEntityName(child.name, root.name)}`;
}

/** The TS type of a finder parameter, looked up across every declared entity. */
export function finderFieldType(blueprint: Blueprint, fieldName: string): string {
  for (const entity of Object.values(blueprint.entities)) {
    const field = entity.fields[fieldName];

    if (field !== undefined) {
      return tsType(field);
    }
  }

  return 'string';
}

function importSection(blueprint: Blueprint, view: RepositoryView): string {
  const { root, children } = view;
  const moduleName = blueprint.module.name;
  const lines: string[] = [];

  if (view.hasConflict || view.hasNotFound || view.hasList) {
    lines.push("import { Prisma } from '@prisma-client';");
  }

  const rowNames = [root, ...children].map((entity) => `${entity.name} as ${entity.name}Row`);
  lines.push(formatImport('import type', rowNames, '@prisma-client'), '');

  if (view.hasList) {
    lines.push(
      "import type { CursorPage, CursorQuery } from '@core/database/pagination';",
      "import { buildCursorPage } from '@core/database/pagination';",
    );
  }

  lines.push("import type { SqlClient } from '@core/database/sql/prisma.adapter';");

  if (view.hasConflict) {
    lines.push("import { ConflictError } from '@core/errors/app-error';");
  }

  const contractNames = new Set<string>([`${root.name}Repository`]);

  if (view.hasCreate) {
    contractNames.add(`New${root.name}`);
  }

  if ((view.hasCreate || view.hasUpdate) && children.length > 0) {
    for (const child of children) {
      contractNames.add(`New${child.name}`);
    }
  }

  if (view.hasUpdate && (blueprint.repository.patch ?? []).length > 0) {
    contractNames.add(`${root.name}Patch`);
  }

  if (view.hasList && blueprint.repository.filter.length > 0) {
    contractNames.add(`${root.name}Filter`);
  }

  lines.push(formatImport('import type', [...contractNames].sort(), `../${moduleName}.repository`));

  const domainNames = [
    root.name,
    ...(children.length > 0 ? [view.detailType] : []),
    ...children.map((child) => child.name),
  ].sort();
  lines.push(
    formatImport('import type', domainNames, `@modules/${moduleName}/types/${moduleName}.types`),
  );

  return lines.join('\n');
}

function errorCodeSection(view: RepositoryView): string {
  return [
    '/** Prisma error codes: https://www.prisma.io/docs/orm/reference/error-reference */',
    ...(view.hasConflict ? ["const UNIQUE_VIOLATION = 'P2002';"] : []),
    ...(view.hasNotFound ? ["const RECORD_NOT_FOUND = 'P2025';"] : []),
  ].join('\n');
}

/** The `include` option shared by every read: children ride along, oldest entry first. */
function includeConst(child: OwnedChildView): string {
  const hasCreatedAt = child.entity.timestamps === true || child.entity.timestamps === 'createdAt';
  const body = hasCreatedAt ? "{ orderBy: { createdAt: 'asc' } }" : 'true';

  return `const ${upperSnakeCase(child.as)} = ${body} as const;`;
}

function detailRowType(root: EntityView, children: OwnedChildView[]): string {
  const parts = children.map((child) => `${child.as}: ${child.name}Row[]`);

  return `type DetailRow = ${root.name}Row & { ${parts.join('; ')} };`;
}

/** The field list of an entity as it appears in every mapper, timestamps included. */
function entityLines(view: EntityView): string[] {
  return [
    'id',
    ...view.fields.map(([fieldName]) => fieldName),
    ...(view.entity.timestamps === undefined || view.entity.timestamps === false
      ? []
      : ['createdAt']),
    ...(view.entity.timestamps === true ? ['updatedAt'] : []),
  ];
}

function rowMapper(fieldNames: string[], name: string, rowType: string): string {
  const domainType = rowType.slice(0, -'Row'.length);

  return [
    `function ${name}(row: ${rowType}): ${domainType} {`,
    '  return {',
    ...fieldNames.map((fieldName) => `    ${fieldName}: row.${fieldName},`),
    '  };',
    '}',
  ].join('\n');
}

function detailMapper(root: EntityView, children: OwnedChildView[]): string {
  const parts = children.map(
    (child) => `${child.as}: row.${child.as}.map(${childMapperName(child, root)})`,
  );
  const inline = `  return { ...to${root.name}(row), ${parts.join(', ')} };`;
  const body =
    inline.length <= PRINT_WIDTH
      ? [inline]
      : [
          '  return {',
          `    ...to${root.name}(row),`,
          ...parts.map((part) => `    ${part},`),
          '  };',
        ];

  return [`function toDetail(row: DetailRow): ${root.name}Detail {`, ...body, '}'].join('\n');
}

function cursorWhereSection(root: EntityView): string {
  return [
    '/** Keyset predicate: everything strictly after (or before) the last row of the previous page. */',
    `function cursorWhere(query: CursorQuery): Prisma.${root.name}WhereInput | undefined {`,
    '  if (query.cursor === null) {',
    '    return undefined;',
    '  }',
    '',
    '  const createdAt = new Date(query.cursor.value);',
    "  const ascending = query.direction === 'asc';",
    '  const bound = ascending ? { gt: createdAt } : { lt: createdAt };',
    '  const idBound = ascending ? { gt: query.cursor.id } : { lt: query.cursor.id };',
    '',
    '  // The tie-break on id is what keeps rows sharing a createdAt from being skipped or repeated.',
    '  return { OR: [{ createdAt: bound }, { createdAt, id: idBound }] };',
    '}',
  ].join('\n');
}

function classSection(blueprint: Blueprint, view: RepositoryView): string {
  const { root } = view;
  const methods: string[] = [];

  if (view.hasCreate) {
    methods.push(createMethod(view));
  }

  if (blueprint.repository.operations.includes('findById')) {
    methods.push(
      finderMethod(
        view,
        'findById',
        ['id: string'],
        '{ id }',
        view.root.entity.softDelete === true,
      ),
    );
  }

  for (const finder of blueprint.repository.extraFinders) {
    const fields = finderFields(finder.by);
    const params = fields.map(
      (fieldName) => `${fieldName}: ${finderFieldType(blueprint, fieldName)}`,
    );
    methods.push(finderMethod(view, finder.name, params, `{ ${fields.join(', ')} }`, false));
  }

  if (view.hasList) {
    methods.push(listMethod(blueprint, view));
  }

  if (view.hasUpdate) {
    methods.push(updateMethod(view));
  }

  if (view.hasRemove) {
    methods.push(removeMethod(view));
  }

  const doc =
    root.entity.softDelete === true
      ? [
          '/**',
          ' * SQL implementation. Soft delete and the `deletedAt IS NULL` scoping are not written here:',
          ' * the Prisma client this repository receives is already extended with them.',
          ' */',
        ]
      : ['/** SQL implementation of the module repository contract. */'];

  return [
    ...doc,
    `export class Prisma${root.name}Repository implements ${root.name}Repository {`,
    '  constructor(private readonly client: SqlClient) {}',
    '',
    methods.join('\n\n'),
    '}',
  ].join('\n');
}

/** `prefix({ a, b });` inline when it fits, one property per line when it does not. */
function objectCall(indent: string, prefix: string, props: string[], suffix: string): string[] {
  const inline = `${indent}${prefix}({ ${props.join(', ')} })${suffix}`;

  if (inline.length <= PRINT_WIDTH) {
    return [inline];
  }

  return [
    `${indent}${prefix}({`,
    ...props.map((prop) => `${indent}  ${prop},`),
    `${indent}})${suffix}`,
  ];
}

function methodSignature(name: string, params: string[], returnType: string): string[] {
  const inline = `  async ${name}(${params.join(', ')}): ${returnType} {`;

  if (inline.length <= PRINT_WIDTH) {
    return [inline];
  }

  return [`  async ${name}(`, ...params.map((param) => `    ${param},`), `  ): ${returnType} {`];
}

/** `data` plus the nested creation of every owned child, as `create` hands it to Prisma. */
function nestedData(view: RepositoryView, source: string): string {
  if (view.children.length === 0) {
    return source;
  }

  const parts = view.children.map((child) => `${child.as}: { create: event }`);

  return `data: { ...${source}, ${parts.join(', ')} }`;
}

function includeProp(view: RepositoryView): string[] {
  if (view.children.length === 0) {
    return [];
  }

  const parts = view.children.map((child) => `${child.as}: ${upperSnakeCase(child.as)}`);

  return [`include: { ${parts.join(', ')} }`];
}

/** The 409 message raised when the root entity's unique column collides. */
export function conflictMessage(fieldName: string): string {
  return `This ${humanize(fieldName)} is already taken`;
}

function conflictCatch(view: RepositoryView, indent: string): string[] {
  const message = conflictMessage(view.uniqueField ?? '');

  return [
    `${indent}} catch (error) {`,
    `${indent}  if (errorCodeOf(error) === UNIQUE_VIOLATION) {`,
    `${indent}    throw new ConflictError('${message}', { cause: error });`,
    `${indent}  }`,
    `${indent}  throw error;`,
    `${indent}}`,
  ];
}

function createMethod(view: RepositoryView): string {
  const { root, children } = view;
  const params = [`data: New${root.name}`, ...children.map((child) => `event: New${child.name}`)];
  const props = [children.length > 0 ? nestedData(view, 'data') : 'data', ...includeProp(view)];
  const lines = methodSignature('create', params, `Promise<${view.detailType}>`);

  if (view.hasConflict) {
    lines.push(
      '    try {',
      ...objectCall('      ', `const row = await ${view.delegate}.create`, props, ';'),
      '',
      `      return ${view.mapper}(row);`,
      ...conflictCatch(view, '    '),
    );
  } else {
    lines.push(
      ...objectCall('    ', `const row = await ${view.delegate}.create`, props, ';'),
      '',
      `    return ${view.mapper}(row);`,
    );
  }

  lines.push('  }');

  return lines.join('\n');
}

function finderMethod(
  view: RepositoryView,
  name: string,
  params: string[],
  where: string,
  softDeleteComment: boolean,
): string {
  const lines = methodSignature(name, params, `Promise<${view.detailType} | null>`);

  if (softDeleteComment) {
    lines.push(
      '    // findFirst rather than findUnique: the extension adds `deletedAt: null` to the filter,',
      '    // which findUnique refuses because it only accepts unique fields.',
    );
  }

  lines.push(
    ...objectCall(
      '    ',
      `const row = await ${view.delegate}.findFirst`,
      [`where: ${where}`, ...includeProp(view)],
      ';',
    ),
    '',
    `    return row === null ? null : ${view.mapper}(row);`,
    '  }',
  );

  return lines.join('\n');
}

function orderByProp(blueprint: Blueprint, indent: string): string[] {
  const ordered = (blueprint.repository.defaultOrder ?? []).map((ref) => {
    const { column, direction } = parseOrderedColumn(ref);

    return `{ ${column}: '${direction ?? 'asc'}' }`;
  });
  const entries = [...ordered, '{ createdAt: query.direction }', '{ id: query.direction }'];
  const inline = `${indent}orderBy: [${entries.join(', ')}],`;

  if (inline.length <= PRINT_WIDTH) {
    return [inline];
  }

  return [`${indent}orderBy: [`, ...entries.map((entry) => `${indent}  ${entry},`), `${indent}],`];
}

function listMethod(blueprint: Blueprint, view: RepositoryView): string {
  const { root } = view;
  const filters = blueprint.repository.filter;
  const whereLines =
    filters.length === 0
      ? ['      where: cursorWhere(query),']
      : [
          '      where: {',
          ...filters.map(
            (field) =>
              `        ...(filter.${field} === null ? {} : { ${field}: filter.${field} }),`,
          ),
          '        ...cursorWhere(query),',
          '      },',
        ];

  return [
    ...methodSignature(
      'list',
      ['query: CursorQuery', `filter: ${root.name}Filter`],
      `Promise<CursorPage<${root.name}>>`,
    ),
    `    const rows = await ${view.delegate}.findMany({`,
    ...whereLines,
    ...orderByProp(blueprint, '      '),
    '      // One row more than asked, so `hasMore` costs no extra query.',
    '      take: query.limit + 1,',
    '    });',
    '',
    `    return buildCursorPage(rows.map(to${root.name}), query.limit, (item) => ({`,
    '      value: item.createdAt.toISOString(),',
    '      id: item.id,',
    '    }));',
    '  }',
  ].join('\n');
}

function updateMethod(view: RepositoryView): string {
  const { root, children } = view;
  const params = [
    'id: string',
    `patch: ${root.name}Patch`,
    ...children.map((child) => `event: New${child.name}`),
  ];
  const props = [
    'where: { id }',
    children.length > 0 ? nestedData(view, 'patch') : 'data: patch',
    ...includeProp(view),
  ];
  const nestedComment =
    children.length > 0
      ? [
          `      // The row change and its ${children[0]?.as ?? ''} entry are one nested write, so a history entry can`,
          '      // never describe a change that did not happen.',
        ]
      : [];

  return [
    ...methodSignature('update', params, `Promise<${view.detailType} | null>`),
    '    try {',
    ...nestedComment,
    ...objectCall('      ', `const row = await ${view.delegate}.update`, props, ';'),
    '',
    `      return ${view.mapper}(row);`,
    '    } catch (error) {',
    '      if (errorCodeOf(error) === RECORD_NOT_FOUND) {',
    '        return null;',
    '      }',
    '      throw error;',
    '    }',
    '  }',
  ].join('\n');
}

function removeMethod(view: RepositoryView): string {
  const soft = view.root.entity.softDelete === true;
  const action = soft
    ? objectCall(
        '      ',
        `await ${view.delegate}.update`,
        ['where: { id }', 'data: { deletedAt: new Date() }'],
        ';',
      )
    : objectCall('      ', `await ${view.delegate}.delete`, ['where: { id }'], ';');

  return [
    '  async remove(id: string): Promise<boolean> {',
    '    try {',
    ...(soft
      ? [
          '      // Soft delete: the extension already scopes this update to a row that is still',
          '      // alive, so deleting twice raises P2025 instead of silently touching a dead row.',
        ]
      : []),
    ...action,
    '',
    '      return true;',
    '    } catch (error) {',
    '      if (errorCodeOf(error) === RECORD_NOT_FOUND) {',
    '        return false;',
    '      }',
    '      throw error;',
    '    }',
    '  }',
  ].join('\n');
}
