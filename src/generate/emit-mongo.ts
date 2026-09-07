import type { Blueprint, BlueprintField } from '../blueprint/schema';
import { parseOrderedColumn } from '../blueprint/schema';
import type { EntityView, OwnedChildView } from './model';
import { PRINT_WIDTH, jsdoc, ownedChildren, rootEntity, tsFieldType, tsType } from './model';
import { camelCase, enumConstName, tableName } from './naming';

/** `repositories/mongo/<module>.schema.ts` — document shapes and Mongoose schemas. */
export function emitMongoSchemaFile(blueprint: Blueprint): string {
  const root = rootEntity(blueprint);
  const children = ownedChildren(blueprint, root.name);
  const sections: string[] = [importSection(blueprint, root, children)];

  for (const child of children) {
    sections.push(documentInterface(child, null, []));
  }

  sections.push(documentInterface(root, root.entity.softDelete === true ? 'soft' : null, children));

  for (const child of children) {
    sections.push(childSchema(child));
  }

  sections.push(rootSchema(blueprint, root, children));
  sections.push(...footerSections(root));

  return `${sections.join('\n\n')}\n`;
}

/** `ComplaintEvent` owned by `Complaint` → `eventSchema`; a free-standing name is kept whole. */
function schemaVarName(view: EntityView, parentName: string | null): string {
  if (parentName !== null && view.name.startsWith(parentName) && view.name !== parentName) {
    return `${camelCase(view.name.slice(parentName.length))}Schema`;
  }

  return `${camelCase(view.name)}Schema`;
}

function mongoType(field: BlueprintField): string {
  switch (field.type) {
    case 'int':
    case 'bigint':
    case 'decimal':
      return 'Number';
    case 'boolean':
      return 'Boolean';
    case 'date':
      return 'Date';
    default:
      return 'String';
  }
}

function importSection(blueprint: Blueprint, root: EntityView, children: OwnedChildView[]): string {
  const lines = [
    "import type { Connection, Model } from 'mongoose';",
    "import { Schema } from 'mongoose';",
    '',
  ];

  if (root.entity.softDelete === true) {
    lines.push("import { softDeletePlugin } from '@core/database/mongo/soft-delete.plugin';");
  }

  const enumConsts = new Set<string>();
  const typeNames = new Set<string>();

  for (const view of [root, ...children]) {
    for (const [, field] of view.fields) {
      if (field.type.startsWith('enum:')) {
        enumConsts.add(enumConstName(field.type.slice('enum:'.length)));
        typeNames.add(tsType(field));
      }

      if (field.type.startsWith('alias:')) {
        typeNames.add(tsType(field));
      }
    }
  }

  const typesPath = `@modules/${blueprint.module.name}/types/${blueprint.module.name}.types`;

  if (enumConsts.size > 0) {
    lines.push(importLine([...enumConsts].sort(), typesPath, false));
  }

  if (typeNames.size > 0) {
    lines.push(importLine([...typeNames].sort(), typesPath, true));
  }

  return lines.join('\n');
}

function importLine(names: string[], path: string, typeOnly: boolean): string {
  const keyword = typeOnly ? 'import type' : 'import';
  const inline = `${keyword} { ${names.join(', ')} } from '${path}';`;

  if (inline.length <= PRINT_WIDTH) {
    return inline;
  }

  return [`${keyword} {`, ...names.map((name) => `  ${name},`), `} from '${path}';`].join('\n');
}

function documentInterface(
  view: EntityView,
  softDelete: 'soft' | null,
  children: OwnedChildView[],
): string {
  const lines = [`export interface ${view.name}Document {`, '  _id: string;'];

  for (const [fieldName, field] of view.fields) {
    lines.push(`  ${fieldName}: ${tsFieldType(field)};`);
  }

  for (const child of children) {
    lines.push(`  ${child.as}: ${child.name}Document[];`);
  }

  if (softDelete === 'soft') {
    lines.push('  deletedAt: Date | null;');
  }

  if (view.entity.timestamps === true || view.entity.timestamps === 'createdAt') {
    lines.push('  createdAt: Date;');
  }

  if (view.entity.timestamps === true) {
    lines.push('  updatedAt: Date;');
  }

  lines.push('}');

  return lines.join('\n');
}

function fieldDefinition(field: BlueprintField, createOmits: Set<string>, name: string): string {
  const parts = [`type: ${mongoType(field)}`];
  const isEnum = field.type.startsWith('enum:');

  if (isEnum) {
    const constName = enumConstName(field.type.slice('enum:'.length));
    parts.push(
      field.nullable === true ? `enum: [...${constName}, null]` : `enum: [...${constName}]`,
    );
  }

  if (field.nullable === true) {
    parts.push('default: null');
  } else if (isEnum && field.default !== undefined && createOmits.has(name)) {
    // The application never sends this field on creation, so the database owns the default.
    parts.push(`default: '${String(field.default)}'`);
  } else {
    parts.push('required: true');
  }

  if (field.unique === true) {
    parts.push('unique: true');
  }

  return `{ ${parts.join(', ')} }`;
}

function childSchema(child: OwnedChildView): string {
  const lines = [
    `const ${schemaVarName(child, child.parent)} = new Schema<${child.name}Document>(`,
    '  {',
    '    _id: { type: String, required: true },',
  ];

  for (const [fieldName, field] of child.fields) {
    lines.push(`    ${fieldName}: ${fieldDefinition(field, new Set(), fieldName)},`);
  }

  if (child.entity.timestamps === 'createdAt' || child.entity.timestamps === true) {
    lines.push('    createdAt: { type: Date, required: true },');
  }

  lines.push('  },', '  { versionKey: false },', ');');

  return lines.join('\n');
}

function rootSchema(blueprint: Blueprint, root: EntityView, children: OwnedChildView[]): string {
  const createOmits = new Set(blueprint.repository.createOmits ?? []);
  const lines: string[] = [];

  for (const child of children) {
    if (child.doc !== undefined) {
      lines.push(jsdoc(child.doc));
    }
  }

  lines.push(
    `const ${schemaVarName(root, null)} = new Schema<${root.name}Document>(`,
    '  {',
    '    _id: { type: String, required: true },',
  );

  for (const [fieldName, field] of root.fields) {
    if (field.gap === true) {
      lines.push('');
    }

    lines.push(`    ${fieldName}: ${fieldDefinition(field, createOmits, fieldName)},`);
  }

  for (const child of children) {
    lines.push(
      '',
      `    ${child.as}: { type: [${schemaVarName(child, child.parent)}], default: [] },`,
    );
  }

  const options = [
    ...(root.entity.timestamps === true ? ['timestamps: true'] : []),
    'versionKey: false',
    `collection: '${tableName(root.name)}'`,
  ];

  lines.push('  },', `  { ${options.join(', ')} },`, ');');

  return lines.join('\n');
}

function footerSections(root: EntityView): string[] {
  const schemaName = schemaVarName(root, null);
  const sections: string[] = [];
  const statements: string[] = [];

  if (root.entity.softDelete === true) {
    sections.push(`${schemaName}.plugin(softDeletePlugin);`);
  }

  if (root.entity.softDelete === true && root.entity.timestamps === true) {
    statements.push(
      '// Mirrors the SQL indexes: the first one serves every keyset page, in sort order.',
      `${schemaName}.index({ deletedAt: 1, createdAt: -1, _id: -1 });`,
    );
  }

  for (const columns of root.entity.indexes ?? []) {
    const rendered = columns
      .map((ref) => {
        const { column, direction } = parseOrderedColumn(ref);
        // Same keyset convention as the Prisma emitter when no direction is spelled out.
        const sort =
          direction === null ? (column === 'createdAt' ? -1 : 1) : direction === 'desc' ? -1 : 1;

        return `${column}: ${sort}`;
      })
      .join(', ');
    statements.push(`${schemaName}.index({ ${rendered} });`);
  }

  if (statements.length > 0) {
    sections.push(statements.join('\n'));
  }

  sections.push(`export type ${root.name}Model = Model<${root.name}Document>;`);
  sections.push(
    [
      '/** Models are bound to a connection, so they are built once the adapter has one. */',
      `export function ${camelCase(root.name)}Model(connection: Connection): ${root.name}Model {`,
      `  return connection.model<${root.name}Document>('${root.name}', ${schemaName});`,
      '}',
    ].join('\n'),
  );

  return sections;
}
