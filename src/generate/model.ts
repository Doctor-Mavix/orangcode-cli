import type { Blueprint, BlueprintDoc, BlueprintEntity, BlueprintField } from '../blueprint/schema';
import { rootEntityName } from '../blueprint/schema';

/**
 * Derived, ordered views over a validated blueprint. Emitters read these instead of walking
 * the raw JSON so ordering and ownership rules are decided in one place.
 */

export interface EntityView {
  name: string;
  entity: BlueprintEntity;
  fields: [string, BlueprintField][];
}

export interface OwnedChildView extends EntityView {
  parent: string;
  as: string;
  doc: BlueprintDoc | undefined;
}

export function entityView(name: string, entity: BlueprintEntity): EntityView {
  return { name, entity, fields: Object.entries(entity.fields) };
}

/** The aggregate root — validation guarantees every blueprint that generates has one. */
export function rootEntity(blueprint: Blueprint): EntityView {
  const name = rootEntityName(blueprint);
  const entity = name === null ? undefined : blueprint.entities[name];

  if (name === null || entity === undefined) {
    throw new Error('Blueprint has no root entity (every entity is owned by another).');
  }

  return entityView(name, entity);
}

/** Entities owned by the given parent, in declaration order. */
export function ownedChildren(blueprint: Blueprint, parentName: string): OwnedChildView[] {
  return Object.entries(blueprint.entities)
    .filter(([, entity]) => entity.ownedBy?.entity === parentName)
    .map(([name, entity]) => ({
      ...entityView(name, entity),
      parent: parentName,
      as: entity.ownedBy?.as ?? '',
      doc: entity.ownedBy?.doc,
    }));
}

/** The TypeScript type a domain field maps to (`Date`, `ComplaintStatus`, `string`…). */
export function tsType(field: BlueprintField): string {
  const { type } = field;

  if (type.startsWith('enum:')) {
    return type.slice('enum:'.length);
  }

  if (type.startsWith('alias:')) {
    return type.slice('alias:'.length);
  }

  switch (type) {
    case 'int':
    case 'decimal':
      return 'number';
    case 'bigint':
      return 'bigint';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'Date';
    case 'json':
      return 'unknown';
    default:
      return 'string';
  }
}

/** The type as it appears on a domain interface, `| null` included. */
export function tsFieldType(field: BlueprintField): string {
  return field.nullable === true ? `${tsType(field)} | null` : tsType(field);
}

export function isEnumRef(type: string): boolean {
  return type.startsWith('enum:');
}

export function enumRefName(type: string): string {
  return type.slice('enum:'.length);
}

/** Renders prose as a JSDoc block: one line for a string, one line per array item. */
export function jsdoc(doc: BlueprintDoc, indent = ''): string {
  if (typeof doc === 'string') {
    return `${indent}/** ${doc} */`;
  }

  return [
    `${indent}/**`,
    ...doc.map((line) => (line === '' ? `${indent} *` : `${indent} * ${line}`)),
    `${indent} */`,
  ].join('\n');
}

export function docLines(doc: BlueprintDoc): string[] {
  return typeof doc === 'string' ? [doc] : doc;
}

/** `ComplaintEvent` under `Complaint` → `Event`; a name sharing no prefix is kept whole. */
export function shortEntityName(name: string, parentName: string): string {
  return name.startsWith(parentName) && name !== parentName ? name.slice(parentName.length) : name;
}

/** Prettier's print width — the emitters break lines exactly where it would. */
export const PRINT_WIDTH = 100;

/** One import statement, broken one name per line when the inline form would overflow. */
export function formatImport(
  keyword: 'import' | 'import type',
  names: string[],
  path: string,
): string {
  const inline = `${keyword} { ${names.join(', ')} } from '${path}';`;

  if (inline.length <= PRINT_WIDTH) {
    return inline;
  }

  return [`${keyword} {`, ...names.map((name) => `  ${name},`), `} from '${path}';`].join('\n');
}
