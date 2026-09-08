import type { Blueprint } from '../blueprint/schema';
import { finderFields, parseOrderedColumn } from '../blueprint/schema';
import type { EntityView, OwnedChildView } from './model';
import {
  PRINT_WIDTH,
  docLines,
  formatImport,
  ownedChildren,
  rootEntity,
  shortEntityName,
} from './model';
import { conflictMessage, finderFieldType } from './emit-prisma-repository';
import { camelCase, numberLiteral } from './naming';

/**
 * `repositories/mongo/<module>.mongo.repository.ts` — the Mongoose implementation. Owned
 * children are embedded documents, so every write is a single-document operation.
 */
export function emitMongoRepositoryFile(blueprint: Blueprint): string {
  const root = rootEntity(blueprint);
  const children = ownedChildren(blueprint, root.name);
  const view = mongoView(blueprint, root, children);

  const sections: string[] = [importSection(blueprint, view)];

  if (view.hasConflict) {
    sections.push(
      [
        '/** MongoDB duplicate key error. */',
        `const DUPLICATE_KEY = ${numberLiteral(11_000)};`,
      ].join('\n'),
    );
    sections.push(
      [
        'function isDuplicateKey(error: unknown): boolean {',
        '  return (',
        "    typeof error === 'object' && error !== null && 'code' in error && error.code === DUPLICATE_KEY",
        '  );',
        '}',
      ].join('\n'),
    );
  }

  for (const child of children) {
    sections.push(
      documentMapper(entityFieldNames(child), childMapperName(child, root), child.name),
    );
  }

  sections.push(documentMapper(entityFieldNames(root), `to${root.name}`, root.name));

  if (children.length > 0) {
    sections.push(detailMapper(root, children));
  }

  if (view.hasCreate || view.hasUpdate) {
    for (const child of children) {
      sections.push(newDocumentMapper(child, root));
    }
  }

  if (view.hasList) {
    sections.push(cursorFilterSection(root));
  }

  sections.push(classSection(blueprint, view));

  return `${sections.join('\n\n')}\n`;
}

interface MongoView {
  root: EntityView;
  children: OwnedChildView[];
  detailType: string;
  mapper: string;
  uniqueField: string | null;
  hasCreate: boolean;
  hasList: boolean;
  hasUpdate: boolean;
  hasRemove: boolean;
  hasConflict: boolean;
}

function mongoView(blueprint: Blueprint, root: EntityView, children: OwnedChildView[]): MongoView {
  const { operations } = blueprint.repository;
  const uniqueField = root.fields.find(([, field]) => field.unique === true)?.[0] ?? null;
  const hasCreate = operations.includes('create');

  return {
    root,
    children,
    detailType: children.length > 0 ? `${root.name}Detail` : root.name,
    mapper: children.length > 0 ? 'toDetail' : `to${root.name}`,
    uniqueField,
    hasCreate,
    hasList: operations.includes('list'),
    hasUpdate: operations.includes('update'),
    hasRemove: operations.includes('remove'),
    hasConflict: hasCreate && uniqueField !== null,
  };
}

function childMapperName(child: OwnedChildView, root: EntityView): string {
  return `to${shortEntityName(child.name, root.name)}`;
}

function importSection(blueprint: Blueprint, view: MongoView): string {
  const { root, children } = view;
  const moduleName = blueprint.module.name;

  const mongooseNames = [
    'Connection',
    ...(view.hasList ? ['QueryFilter'] : []),
    ...(view.hasUpdate && children.length > 0 ? ['UpdateQuery'] : []),
  ];
  const lines = [formatImport('import type', mongooseNames, 'mongoose'), ''];

  if (view.hasList) {
    lines.push(
      "import type { CursorPage, CursorQuery } from '@core/database/pagination';",
      "import { buildCursorPage } from '@core/database/pagination';",
    );
  }

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

  const schemaTypes = [
    `${root.name}Document`,
    ...children.map((child) => `${child.name}Document`),
    `${root.name}Model`,
  ].sort();
  lines.push(`import { ${camelCase(root.name)}Model } from './${moduleName}.schema';`);
  lines.push(formatImport('import type', schemaTypes, `./${moduleName}.schema`));

  return lines.join('\n');
}

/** The field list of an entity as its mapper reads it, timestamps included. */
function entityFieldNames(view: EntityView): string[] {
  return [
    ...view.fields.map(([fieldName]) => fieldName),
    ...(view.entity.timestamps === true || view.entity.timestamps === 'createdAt'
      ? ['createdAt']
      : []),
    ...(view.entity.timestamps === true ? ['updatedAt'] : []),
  ];
}

function documentMapper(fieldNames: string[], name: string, entityName: string): string {
  return [
    `function ${name}(document: ${entityName}Document): ${entityName} {`,
    '  return {',
    '    id: document._id,',
    ...fieldNames.map((fieldName) => `    ${fieldName}: document.${fieldName},`),
    '  };',
    '}',
  ].join('\n');
}

function detailMapper(root: EntityView, children: OwnedChildView[]): string {
  const parts = children.map(
    (child) => `${child.as}: document.${child.as}.map(${childMapperName(child, root)})`,
  );
  const inline = `  return { ...to${root.name}(document), ${parts.join(', ')} };`;
  const body =
    inline.length <= PRINT_WIDTH
      ? [inline]
      : [
          '  return {',
          `    ...to${root.name}(document),`,
          ...parts.map((part) => `    ${part},`),
          '  };',
        ];

  return [
    `function toDetail(document: ${root.name}Document): ${root.name}Detail {`,
    ...body,
    '}',
  ].join('\n');
}

/** `New<Child>` → embedded document, stamped with the write time the caller decided. */
function newDocumentMapper(child: OwnedChildView, root: EntityView): string {
  const name = `${childMapperName(child, root)}Document`;
  const hasCreatedAt = child.entity.timestamps === true || child.entity.timestamps === 'createdAt';

  return [
    `function ${name}(event: New${child.name}, createdAt: Date): ${child.name}Document {`,
    '  return {',
    '    _id: event.id,',
    ...child.fields.map(([fieldName]) => `    ${fieldName}: event.${fieldName},`),
    ...(hasCreatedAt ? ['    createdAt,'] : []),
    '  };',
    '}',
  ].join('\n');
}

function cursorFilterSection(root: EntityView): string {
  return [
    `function cursorFilter(query: CursorQuery): QueryFilter<${root.name}Document> {`,
    '  if (query.cursor === null) {',
    '    return {};',
    '  }',
    '',
    '  const createdAt = new Date(query.cursor.value);',
    "  const ascending = query.direction === 'asc';",
    '  const bound = ascending ? { $gt: createdAt } : { $lt: createdAt };',
    '  const idBound = ascending ? { $gt: query.cursor.id } : { $lt: query.cursor.id };',
    '',
    '  return { $or: [{ createdAt: bound }, { createdAt, _id: idBound }] };',
    '}',
  ].join('\n');
}

function classSection(blueprint: Blueprint, view: MongoView): string {
  const { root } = view;
  const methods: string[] = [];

  if (view.hasCreate) {
    methods.push(createMethod(view));
  }

  if (blueprint.repository.operations.includes('findById')) {
    methods.push(finderMethod(view, 'findById', ['id: string'], '{ _id: id }'));
  }

  for (const finder of blueprint.repository.extraFinders) {
    const fields = finderFields(finder.by);
    const params = fields.map(
      (fieldName) => `${fieldName}: ${finderFieldType(blueprint, fieldName)}`,
    );
    methods.push(finderMethod(view, finder.name, params, `{ ${fields.join(', ')} }`));
  }

  if (view.hasList) {
    methods.push(listMethod(blueprint, view));
  }

  if (view.hasUpdate) {
    methods.push(updateMethod(blueprint, view));
  }

  if (view.hasRemove) {
    methods.push(removeMethod(view));
  }

  const doc =
    root.entity.softDelete === true
      ? [
          '/**',
          ' * MongoDB implementation of the same contract. The `deletedAt IS NULL` scoping comes from',
          ' * `softDeletePlugin`, applied to the schema, so it is never restated in a query here.',
          ' */',
        ]
      : ['/** MongoDB implementation of the same contract. */'];

  return [
    ...doc,
    `export class Mongo${root.name}Repository implements ${root.name}Repository {`,
    `  private readonly model: ${root.name}Model;`,
    '',
    '  constructor(connection: Connection) {',
    `    this.model = ${camelCase(root.name)}Model(connection);`,
    '  }',
    '',
    methods.join('\n\n'),
    '}',
  ].join('\n');
}

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

function createMethod(view: MongoView): string {
  const { root, children } = view;
  const params = [`data: New${root.name}`, ...children.map((child) => `event: New${child.name}`)];
  const props = [
    '...data',
    '_id: data.id',
    ...children.map(
      (child) => `${child.as}: [${childMapperName(child, root)}Document(event, now)]`,
    ),
  ];
  const lines = methodSignature('create', params, `Promise<${view.detailType}>`);

  if (children.length > 0) {
    lines.push('    const now = new Date();', '');
  }

  if (view.hasConflict) {
    lines.push(
      '    try {',
      ...objectCall('      ', 'const created = await this.model.create', props, ';'),
      '',
      `      return ${view.mapper}(created.toObject());`,
      '    } catch (error) {',
      '      if (isDuplicateKey(error)) {',
      `        throw new ConflictError('${conflictMessage(view.uniqueField ?? '')}', { cause: error });`,
      '      }',
      '      throw error;',
      '    }',
    );
  } else {
    lines.push(
      ...objectCall('    ', 'const created = await this.model.create', props, ';'),
      '',
      `    return ${view.mapper}(created.toObject());`,
    );
  }

  lines.push('  }');

  return lines.join('\n');
}

/** `await this.model.<call>.lean<T>();` — chain-broken the way Prettier would. */
function leanQuery(assign: string, call: string, leanType: string): string[] {
  const inline = `    const ${assign} = await this.model.${call}.lean<${leanType}>();`;

  if (inline.length <= PRINT_WIDTH) {
    return [inline];
  }

  return [
    `    const ${assign} = await this.model`,
    `      .${call}`,
    `      .lean<${leanType}>();`,
  ];
}

function finderMethod(view: MongoView, name: string, params: string[], filter: string): string {
  return [
    ...methodSignature(name, params, `Promise<${view.detailType} | null>`),
    ...leanQuery('document', `findOne(${filter})`, `${view.root.name}Document | null`),
    '',
    `    return document === null ? null : ${view.mapper}(document);`,
    '  }',
  ].join('\n');
}

function sortLine(blueprint: Blueprint): string {
  const ordered = (blueprint.repository.defaultOrder ?? []).map((ref) => {
    const { column, direction } = parseOrderedColumn(ref);

    return `${column}: ${direction === 'desc' ? -1 : 1}`;
  });
  const entries = [...ordered, 'createdAt: direction', '_id: direction'];

  return `      .sort({ ${entries.join(', ')} })`;
}

function listMethod(blueprint: Blueprint, view: MongoView): string {
  const { root } = view;
  const filters = blueprint.repository.filter;
  const findLines =
    filters.length === 0
      ? ['      .find(cursorFilter(query))']
      : [
          '      .find({',
          ...filters.map(
            (field) =>
              `        ...(filter.${field} === null ? {} : { ${field}: filter.${field} }),`,
          ),
          '        ...cursorFilter(query),',
          '      })',
        ];

  const params = ['query: CursorQuery'];

  if (filters.length > 0) {
    params.push(`filter: ${root.name}Filter`);
  }

  return [
    ...methodSignature('list', params, `Promise<CursorPage<${root.name}>>`),
    "    const direction = query.direction === 'asc' ? 1 : -1;",
    '    const documents = await this.model',
    ...findLines,
    sortLine(blueprint),
    '      // One row more than asked, so `hasMore` costs no extra query.',
    '      .limit(query.limit + 1)',
    `      .lean<${root.name}Document[]>();`,
    '',
    `    return buildCursorPage(documents.map(to${root.name}), query.limit, (item) => ({`,
    '      value: item.createdAt.toISOString(),',
    '      id: item.id,',
    '    }));',
    '  }',
  ].join('\n');
}

function updateMethod(blueprint: Blueprint, view: MongoView): string {
  const { root, children } = view;
  const params = [
    'id: string',
    `patch: ${root.name}Patch`,
    ...children.map((child) => `event: New${child.name}`),
  ];
  const lines = methodSignature('update', params, `Promise<${view.detailType} | null>`);

  if (children.length > 0) {
    const pushes = children.map(
      (child) => `${child.as}: ${childMapperName(child, root)}Document(event, new Date())`,
    );
    const push = `$push: { ${pushes.join(', ')} }`;
    const inline = `    const update: UpdateQuery<${root.name}Document> = { ${push} };`;
    const emptyPatch = blueprint.repository.docs?.emptyPatch;

    lines.push(
      ...(inline.length <= PRINT_WIDTH
        ? [inline]
        : [`    const update: UpdateQuery<${root.name}Document> = {`, `      ${push},`, '    };']),
      '',
      ...docLines(emptyPatch ?? 'MongoDB rejects an empty $set.').map((line) => `    // ${line}`),
      '    if (Object.keys(patch).length > 0) {',
      '      update.$set = patch;',
      '    }',
      '',
      ...leanQuery(
        'document',
        "findOneAndUpdate({ _id: id }, update, { returnDocument: 'after' })",
        `${root.name}Document | null`,
      ),
    );
  } else {
    lines.push(
      ...leanQuery(
        'document',
        "findOneAndUpdate({ _id: id }, { $set: patch }, { returnDocument: 'after' })",
        `${root.name}Document | null`,
      ),
    );
  }

  lines.push('', `    return document === null ? null : ${view.mapper}(document);`, '  }');

  return lines.join('\n');
}

function removeMethod(view: MongoView): string {
  const soft = view.root.entity.softDelete === true;

  return [
    '  async remove(id: string): Promise<boolean> {',
    soft
      ? '    const result = await this.model.updateOne({ _id: id }, { $set: { deletedAt: new Date() } });'
      : '    const result = await this.model.deleteOne({ _id: id });',
    '',
    soft ? '    return result.matchedCount === 1;' : '    return result.deletedCount === 1;',
    '  }',
  ].join('\n');
}
