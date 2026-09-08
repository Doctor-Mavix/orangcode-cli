import type { Blueprint, BlueprintField } from '../blueprint/schema';
import { parseOrderedColumn } from '../blueprint/schema';
import type { EntityView, OwnedChildView } from './model';
import { docLines, ownedChildren, rootEntity } from './model';
import { camelCase, snakeCase, tableName } from './naming';

/**
 * The module's region of `prisma/schema.prisma`: enums first, then the root model, then its
 * owned children. The caller wraps this block in `/// orangcode:models:<module>` markers.
 */
export function emitPrismaBlock(blueprint: Blueprint): string {
  const sections: string[] = [];

  for (const [enumName, values] of Object.entries(blueprint.enums)) {
    sections.push([`enum ${enumName} {`, ...values.map((value) => `  ${value}`), '}'].join('\n'));
  }

  const root = rootEntity(blueprint);
  const children = ownedChildren(blueprint, root.name);

  sections.push(rootModel(root, children));
  sections.push(...children.map((child) => childModel(child)));

  return `${sections.join('\n\n')}\n`;
}

interface Row {
  name: string;
  type: string;
  attributes: string[];
  doc: string[];
}

function prismaType(field: BlueprintField): string {
  const { type } = field;

  if (type.startsWith('enum:')) {
    return type.slice('enum:'.length);
  }

  if (type.startsWith('alias:')) {
    return 'String';
  }

  switch (type) {
    case 'int':
      return 'Int';
    case 'bigint':
      return 'BigInt';
    case 'decimal':
      return 'Decimal';
    case 'boolean':
      return 'Boolean';
    case 'date':
      return 'DateTime';
    case 'json':
      return 'Json';
    default:
      return 'String';
  }
}

function fieldRow(fieldName: string, field: BlueprintField): Row {
  const attributes: string[] = [];

  if (field.unique === true) {
    attributes.push('@unique');
  }

  // A nullable column defaults to NULL by omission — @default(null) is not valid Prisma.
  if (field.default !== undefined && field.default !== null) {
    attributes.push(`@default(${defaultLiteral(field)})`);
  }

  const mapped = snakeCase(fieldName);

  if (mapped !== fieldName) {
    attributes.push(`@map("${mapped}")`);
  }

  return {
    name: fieldName,
    type: `${prismaType(field)}${field.nullable === true ? '?' : ''}`,
    attributes,
    doc: field.doc === undefined ? [] : docLines(field.doc),
  };
}

function defaultLiteral(field: BlueprintField): string {
  const value = field.default;

  if (typeof value === 'string') {
    // Enum defaults are bare identifiers; string defaults are quoted literals.
    return field.type.startsWith('enum:') ? value : `"${value}"`;
  }

  return String(value);
}

/** Splits the declared fields into visual groups at every `gap: true`. */
function fieldGroups(view: EntityView): Row[][] {
  const groups: Row[][] = [[{ name: 'id', type: 'String', attributes: ['@id'], doc: [] }]];

  for (const [fieldName, field] of view.fields) {
    if (field.gap === true) {
      groups.push([]);
    }

    groups.at(-1)?.push(fieldRow(fieldName, field));
  }

  return groups;
}

function timestampRows(view: EntityView): Row[] {
  const rows: Row[] = [];

  if (view.entity.timestamps === true || view.entity.timestamps === 'createdAt') {
    rows.push({
      name: 'createdAt',
      type: 'DateTime',
      attributes: ['@default(now())', '@map("created_at")'],
      doc: [],
    });
  }

  if (view.entity.timestamps === true) {
    rows.push({
      name: 'updatedAt',
      type: 'DateTime',
      attributes: ['@updatedAt', '@map("updated_at")'],
      doc: [],
    });
  }

  if (view.entity.softDelete === true) {
    rows.push({
      name: 'deletedAt',
      type: 'DateTime?',
      attributes: ['@map("deleted_at")'],
      doc: [],
    });
  }

  return rows;
}

function renderGroup(rows: Row[]): string[] {
  const nameWidth = Math.max(...rows.map((row) => row.name.length));
  const typeWidth = Math.max(...rows.map((row) => row.type.length));

  return rows.flatMap((row) => {
    const docLinesOut = row.doc.map((line) => `  /// ${line}`);
    const base = `  ${row.name.padEnd(nameWidth)} ${row.type}`;

    if (row.attributes.length === 0) {
      return [...docLinesOut, base];
    }

    return [
      ...docLinesOut,
      `  ${row.name.padEnd(nameWidth)} ${row.type.padEnd(typeWidth)} ${row.attributes.join(' ')}`,
    ];
  });
}

function indexColumn(ref: string): string {
  const { column, direction } = parseOrderedColumn(ref);

  if (direction !== null) {
    return direction === 'desc' ? `${column}(sort: Desc)` : column;
  }

  // Keyset convention when the blueprint does not say: newest first on time and id columns.
  return column === 'createdAt' || column === 'id' ? `${column}(sort: Desc)` : column;
}

function rootModel(root: EntityView, children: OwnedChildView[]): string {
  const groups = fieldGroups(root);
  const timestamps = timestampRows(root);

  if (timestamps.length > 0) {
    groups.push(timestamps);
  }

  const lines = [`model ${root.name} {`];
  groups.forEach((group, index) => {
    if (index > 0) {
      lines.push('');
    }

    lines.push(...renderGroup(group));
  });

  for (const child of children) {
    lines.push(
      '',
      ...renderGroup([{ name: child.as, type: `${child.name}[]`, attributes: [], doc: [] }]),
    );
  }

  lines.push('');

  for (const columns of root.entity.uniques ?? []) {
    lines.push(`  @@unique([${columns.join(', ')}])`);
  }

  if (root.entity.softDelete === true && root.entity.timestamps === true) {
    lines.push(
      '  // Keyset pagination reads (createdAt, id) in that order; the partial-friendly',
      '  // deletedAt column keeps soft-deleted rows out of every list query.',
      '  @@index([deletedAt, createdAt(sort: Desc), id(sort: Desc)])',
    );
  }

  for (const columns of root.entity.indexes ?? []) {
    lines.push(`  @@index([${columns.map(indexColumn).join(', ')}])`);
  }

  lines.push(`  @@map("${tableName(root.name)}")`, '}');

  return lines.join('\n');
}

function childModel(child: OwnedChildView): string {
  const foreignKey = `${camelCase(child.parent)}Id`;
  const rows: Row[] = [
    { name: 'id', type: 'String', attributes: ['@id'], doc: [] },
    {
      name: foreignKey,
      type: 'String',
      attributes: [`@map("${snakeCase(foreignKey)}")`],
      doc: [],
    },
    ...child.fields.map(([fieldName, field]) => fieldRow(fieldName, field)),
    ...timestampRows(child),
  ];

  const relation = `  ${camelCase(child.parent)} ${child.parent} @relation(fields: [${foreignKey}], references: [id], onDelete: Cascade)`;
  const indexColumns = [
    foreignKey,
    ...(child.entity.timestamps === true || child.entity.timestamps === 'createdAt'
      ? ['createdAt']
      : []),
  ];

  return [
    `model ${child.name} {`,
    ...renderGroup(rows),
    '',
    relation,
    '',
    `  @@index([${indexColumns.join(', ')}])`,
    `  @@map("${tableName(child.name)}")`,
    '}',
  ].join('\n');
}
