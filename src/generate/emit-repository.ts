import type { Blueprint, BlueprintField } from '../blueprint/schema';
import { finderFields } from '../blueprint/schema';
import type { EntityView, OwnedChildView } from './model';
import { PRINT_WIDTH, ownedChildren, rootEntity, tsFieldType, tsType } from './model';
import { humanize, upperSnakeCase } from './naming';

/** `repositories/<module>.repository.ts` — the provider-free contract plus its DI token. */
export function emitRepositoryFile(blueprint: Blueprint): string {
  const root = rootEntity(blueprint);
  const children = ownedChildren(blueprint, root.name);
  const detailType = children.length > 0 ? `${root.name}Detail` : root.name;

  const sections: string[] = [];

  sections.push(newRootInterface(blueprint, root));
  sections.push(...children.map((child) => newChildInterface(child)));

  const patchFields = blueprint.repository.patch ?? [];

  if (patchFields.length > 0) {
    sections.push(patchInterface(root, patchFields));
  }

  if (blueprint.repository.filter.length > 0) {
    sections.push(filterInterface(root, blueprint.repository.filter));
  }

  sections.push(repositoryInterface(blueprint, root, children, detailType));
  sections.push(tokenSection(blueprint, root));

  const body = sections.join('\n\n');

  return `${importSection(blueprint, root, children, body)}\n\n${body}\n`;
}

function importSection(
  blueprint: Blueprint,
  root: EntityView,
  children: OwnedChildView[],
  body: string,
): string {
  const lines = ["import type { InjectionToken } from 'tsyringe';", ''];

  if (blueprint.repository.operations.includes('list')) {
    lines.push("import type { CursorPage, CursorQuery } from '@core/database/pagination';");
  }

  const candidates = new Set<string>([root.name, `${root.name}Detail`]);

  for (const entity of [root, ...children]) {
    for (const [, field] of entity.fields) {
      const { type } = field;

      if (type.startsWith('enum:') || type.startsWith('alias:')) {
        candidates.add(tsType(field));
      }
    }
  }

  const used = [...candidates].filter((name) => new RegExp(`\\b${name}\\b`).exec(body)).sort();
  lines.push(importTypeLine(used, `../types/${blueprint.module.name}.types`));

  return lines.join('\n');
}

function importTypeLine(names: string[], path: string): string {
  const inline = `import type { ${names.join(', ')} } from '${path}';`;

  if (inline.length <= PRINT_WIDTH) {
    return inline;
  }

  return ['import type {', ...names.map((name) => `  ${name},`), `} from '${path}';`].join('\n');
}

function newRootInterface(blueprint: Blueprint, root: EntityView): string {
  const omitted = new Set(blueprint.repository.createOmits ?? []);
  const lines = [
    '/** A complete row, as the service hands it to a repository. Identity is domain-owned. */',
    `export interface New${root.name} {`,
    '  id: string;',
  ];

  for (const [fieldName, field] of root.fields) {
    if (!omitted.has(fieldName)) {
      lines.push(`  ${fieldName}: ${tsFieldType(field)};`);
    }
  }

  lines.push('}');

  return lines.join('\n');
}

function newChildInterface(child: OwnedChildView): string {
  const lines = [
    '/** Appended in the same write as the change it describes, so the history can never drift. */',
    `export interface New${child.name} {`,
    '  id: string;',
  ];

  for (const [fieldName, field] of child.fields) {
    lines.push(`  ${fieldName}: ${tsFieldType(field)};`);
  }

  lines.push('}');

  return lines.join('\n');
}

function patchInterface(root: EntityView, patchFields: string[]): string {
  const lines = [
    '/** Only the fields an update may touch; the service has already validated the transition. */',
    `export interface ${root.name}Patch {`,
  ];

  for (const fieldName of patchFields) {
    const field = root.entity.fields[fieldName];

    if (field !== undefined) {
      lines.push(`  ${fieldName}?: ${tsFieldType(field)};`);
    }
  }

  lines.push('}');

  return lines.join('\n');
}

function filterInterface(root: EntityView, filterFields: string[]): string {
  const lines = [`export interface ${root.name}Filter {`];

  for (const fieldName of filterFields) {
    const field = root.entity.fields[fieldName];

    if (field !== undefined) {
      lines.push(`  ${fieldName}: ${tsType(field)} | null;`);
    }
  }

  lines.push('}');

  return lines.join('\n');
}

function repositoryInterface(
  blueprint: Blueprint,
  root: EntityView,
  children: OwnedChildView[],
  detailType: string,
): string {
  const { operations, extraFinders } = blueprint.repository;
  const eventParams = children.map((child) => `event: New${child.name}`);
  const lines = [`export interface ${root.name}Repository {`];

  if (operations.includes('create')) {
    lines.push(
      ...method('create', [`data: New${root.name}`, ...eventParams], `Promise<${detailType}>`),
    );
  }

  if (operations.includes('findById')) {
    lines.push(...method('findById', ['id: string'], `Promise<${detailType} | null>`));
  }

  for (const finder of extraFinders) {
    const params = finderFields(finder.by).map((fieldName) => {
      const field = findField(blueprint, fieldName);

      return `${fieldName}: ${field === undefined ? 'string' : tsType(field)}`;
    });
    lines.push(...method(finder.name, params, `Promise<${detailType} | null>`));
  }

  if (operations.includes('list')) {
    const listParams = ['query: CursorQuery'];

    if (blueprint.repository.filter.length > 0) {
      listParams.push(`filter: ${root.name}Filter`);
    }

    lines.push(...method('list', listParams, `Promise<CursorPage<${root.name}>>`));
  }

  if (operations.includes('update')) {
    lines.push(
      '  /** Returns null when the id matches nothing alive, so the service can raise a 404. */',
      ...method(
        'update',
        ['id: string', `patch: ${root.name}Patch`, ...eventParams],
        `Promise<${detailType} | null>`,
      ),
    );
  }

  if (operations.includes('remove')) {
    const mode = root.entity.softDelete === true ? 'Soft delete. ' : '';
    lines.push(
      `  /** ${mode}False when the ${humanize(root.name)} was already gone. */`,
      ...method('remove', ['id: string'], 'Promise<boolean>'),
    );
  }

  lines.push('}');

  return lines.join('\n');
}

function method(name: string, params: string[], returnType: string): string[] {
  const inline = `  ${name}(${params.join(', ')}): ${returnType};`;

  if (inline.length <= PRINT_WIDTH) {
    return [inline];
  }

  return [`  ${name}(`, ...params.map((param) => `    ${param},`), `  ): ${returnType};`];
}

function tokenSection(blueprint: Blueprint, root: EntityView): string {
  const tokenName = `${upperSnakeCase(blueprint.module.name)}_REPOSITORY`;
  const doc = [
    '/**',
    ` * Module-local token: the ${blueprint.module.name} module can be lifted into its own service without`,
    ' * dragging a core-wide token registry along with it.',
    ' */',
  ];
  const inline = `export const ${tokenName} = Symbol('${root.name}Repository') as InjectionToken<${root.name}Repository>;`;

  if (inline.length <= PRINT_WIDTH) {
    return [...doc, inline].join('\n');
  }

  return [
    ...doc,
    `export const ${tokenName} = Symbol(`,
    `  '${root.name}Repository',`,
    `) as InjectionToken<${root.name}Repository>;`,
  ].join('\n');
}

function findField(blueprint: Blueprint, fieldName: string): BlueprintField | undefined {
  for (const entity of Object.values(blueprint.entities)) {
    const field = entity.fields[fieldName];

    if (field !== undefined) {
      return field;
    }
  }

  return undefined;
}
