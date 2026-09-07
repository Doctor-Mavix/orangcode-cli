/**
 * Deterministic name derivations. Everything a generated file calls something comes from
 * here, so a naming decision is made exactly once and byte-stability is a property of the
 * code rather than a hope.
 */

/** `ComplaintEventType` → `['Complaint', 'Event', 'Type']`; also accepts camelCase. */
export function words(name: string): string[] {
  const matched = name.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+/g);
  return matched ?? [name];
}

/** English plural of a single word, keeping its capitalization: `Status` → `Statuses`. */
export function pluralize(word: string): string {
  if (/[^aeiou]y$/i.test(word)) {
    return `${word.slice(0, -1)}ies`;
  }

  if (/(?:s|x|z|ch|sh)$/i.test(word)) {
    return `${word}es`;
  }

  return `${word}s`;
}

export function pascalCase(name: string): string {
  return words(name)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

export function camelCase(name: string): string {
  const pascal = pascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** `trackingNumber` → `tracking_number`. */
export function snakeCase(name: string): string {
  return words(name)
    .map((word) => word.toLowerCase())
    .join('_');
}

/** `complaint` → `COMPLAINT`, `wallet-transfer` → `WALLET_TRANSFER`. */
export function upperSnakeCase(name: string): string {
  return name
    .split('-')
    .flatMap((part) => words(part))
    .map((word) => word.toUpperCase())
    .join('_');
}

/** `ComplaintStatus` → `COMPLAINT_STATUSES`: the `X as const` list backing the enum type. */
export function enumConstName(enumName: string): string {
  const parts = words(enumName);
  const last = parts.at(-1) ?? enumName;

  return [...parts.slice(0, -1), pluralize(last)].map((word) => word.toUpperCase()).join('_');
}

/** `complaint` → `complaints`, `wallet-transfer` → `wallet-transfers`: URL/file segment. */
export function kebabPlural(name: string): string {
  const parts = name.split('-');
  const last = parts.at(-1) ?? name;

  return [...parts.slice(0, -1), pluralize(last)].join('-');
}

/** `ComplaintEvent` → `complaint_events`: plural snake_case table/collection name. */
export function tableName(entityName: string): string {
  const parts = words(entityName).map((word) => word.toLowerCase());
  const last = parts.at(-1) ?? entityName.toLowerCase();

  return [...parts.slice(0, -1), pluralize(last)].join('_');
}

/** `ComplaintEvent` → `complaint event`: the entity as prose. */
export function humanize(entityName: string): string {
  return words(entityName)
    .map((word) => word.toLowerCase())
    .join(' ');
}

/** Formats a literal the way Prettier prints it: underscore groups from 1000 up. */
export function numberLiteral(value: number): string {
  if (Math.abs(value) < 1000 || !Number.isInteger(value)) {
    return String(value);
  }

  return value.toLocaleString('en-US').replaceAll(',', '_');
}
