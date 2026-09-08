import type { Blueprint, BlueprintInput, BlueprintInputField } from '../blueprint/schema';
import { PRINT_WIDTH, jsdoc } from './model';
import { enumConstName, numberLiteral, pascalCase } from './naming';

/** `schemas/<module>.schemas.ts` — one Zod schema per declared input, in order. */
export function emitSchemasFile(blueprint: Blueprint): string {
  const inputs = Object.entries(blueprint.inputs ?? {});
  const usage = collectUsage(inputs.map(([, input]) => input));

  const sections: string[] = [importSection(blueprint, usage)];

  if (usage.usesUuid) {
    sections.push(
      [
        '/**',
        ' * Identifiers are UUIDs on both engines — the domain generates them, the database only',
        ' * stores them — so one schema validates the path parameter whatever DB_PROVIDER is set to.',
        ' */',
        'const idSchema = z.uuid();',
      ].join('\n'),
    );
  }

  if (usage.usesOptionalText) {
    sections.push(
      [
        'const optionalText = (max: number): z.ZodOptional<z.ZodString> =>',
        '  z.string().trim().min(1).max(max).optional();',
      ].join('\n'),
    );
  }

  for (const [name, input] of inputs) {
    sections.push(...inputSections(name, input));
  }

  return `${sections.join('\n\n')}\n`;
}

interface Usage {
  usesUuid: boolean;
  usesOptionalText: boolean;
  usesPagination: boolean;
  enumConsts: Set<string>;
  patternImports: Map<string, Set<string>>;
}

function collectUsage(inputs: BlueprintInput[]): Usage {
  const usage: Usage = {
    usesUuid: false,
    usesOptionalText: false,
    usesPagination: false,
    enumConsts: new Set(),
    patternImports: new Map(),
  };

  for (const input of inputs) {
    usage.usesPagination ||= input.paginated === true;

    for (const field of Object.values(input.fields)) {
      usage.usesUuid ||= field.type === 'uuid';
      usage.usesOptionalText ||= isOptionalText(input, field);

      if (field.type.startsWith('enum:')) {
        usage.enumConsts.add(enumConstName(field.type.slice('enum:'.length)));
      }

      if (field.patternFrom !== undefined) {
        const exports = usage.patternImports.get(field.patternFrom.file) ?? new Set();
        exports.add(field.patternFrom.export);
        usage.patternImports.set(field.patternFrom.file, exports);
      }
    }
  }

  return usage;
}

/**
 * Body fields that are "optional trimmed text, at least one character" all share the local
 * `optionalText` helper; queries spell the chain out because they extend a shared schema and
 * read better flat.
 */
function isOptionalText(input: BlueprintInput, field: BlueprintInputField): boolean {
  return (
    input.kind === 'body' &&
    field.type === 'string' &&
    field.optional === true &&
    field.nullable !== true &&
    field.min === 1 &&
    field.max !== undefined &&
    field.pattern === undefined &&
    field.patternFrom === undefined &&
    field.uppercase !== true
  );
}

function importSection(blueprint: Blueprint, usage: Usage): string {
  const lines = ["import { z } from 'zod';", ''];
  const grouped: { path: string; names: string[] }[] = [];

  if (usage.usesPagination) {
    grouped.push({ path: '@core/database/pagination', names: ['cursorQuerySchema'] });
  }

  if (usage.enumConsts.size > 0) {
    grouped.push({
      path: `../types/${blueprint.module.name}.types`,
      names: [...usage.enumConsts].sort(),
    });
  }

  for (const [file, exports] of [...usage.patternImports.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    grouped.push({ path: file, names: [...exports].sort() });
  }

  const aliased = grouped.filter((entry) => entry.path.startsWith('@'));
  const relative = grouped.filter((entry) => !entry.path.startsWith('@'));

  for (const entry of [...aliased, ...relative]) {
    lines.push(importLine(entry.names, entry.path));
  }

  return lines.join('\n');
}

function importLine(names: string[], path: string): string {
  const inline = `import { ${names.join(', ')} } from '${path}';`;

  if (inline.length <= PRINT_WIDTH) {
    return inline;
  }

  return ['import {', ...names.map((name) => `  ${name},`), `} from '${path}';`].join('\n');
}

function inputSections(name: string, input: BlueprintInput): string[] {
  const schemaName = `${name}Schema`;
  const doc = input.doc === undefined ? '' : `${jsdoc(input.doc)}\n`;

  // A paginated query with no fields of its own IS the cursor schema — no empty extend.
  if (input.paginated === true && Object.keys(input.fields).length === 0) {
    return [
      `${doc}export const ${schemaName} = cursorQuerySchema;`,
      `export type ${pascalCase(name)}Query = z.infer<typeof ${schemaName}>;`,
    ];
  }

  const opener = input.paginated === true ? 'cursorQuerySchema.extend({' : 'z.strictObject({';

  const fieldLines = Object.entries(input.fields).map(([fieldName, field]) =>
    fieldLine(fieldName, field, input),
  );

  const inline = `${doc}export const ${schemaName} = ${opener} ${Object.entries(input.fields)
    .map(([fieldName, field]) => `${fieldName}: ${chainOf(field, input).inline}`)
    .join(', ')} });`;

  // Params are one-liners by convention when they fit; bodies and queries always expand.
  const declaration =
    input.kind === 'params' && inline.length <= PRINT_WIDTH && !inline.includes('\n')
      ? inline
      : `${doc}export const ${schemaName} = ${opener}\n${fieldLines.join('\n')}\n});`;

  const sections = [declaration];

  if (input.kind !== 'params') {
    const suffix = input.kind === 'body' ? 'Input' : 'Query';
    sections.push(`export type ${pascalCase(name)}${suffix} = z.infer<typeof ${schemaName}>;`);
  }

  return sections;
}

interface Chain {
  head: string;
  segments: string[];
  inline: string;
}

function chainOf(field: BlueprintInputField, input: BlueprintInput): Chain {
  const built = buildChain(field, input);
  const inline =
    built.segments.length === 0 ? built.head : `${built.head}.${built.segments.join('.')}`;

  return { ...built, inline };
}

function buildChain(
  field: BlueprintInputField,
  input: BlueprintInput,
): { head: string; segments: string[] } {
  if (field.type === 'uuid') {
    return { head: 'idSchema', segments: [] };
  }

  if (isOptionalText(input, field)) {
    return { head: `optionalText(${numberLiteral(field.max ?? 0)})`, segments: [] };
  }

  const segments: string[] = [];
  let head = 'z';

  if (field.type.startsWith('enum:')) {
    segments.push(`enum(${enumConstName(field.type.slice('enum:'.length))})`);
  } else if (field.type === 'email') {
    segments.push('email()');
  } else if (field.type === 'url') {
    segments.push('url()');
  } else if (field.type === 'date') {
    head = 'z.coerce';
    segments.push('date()');
  } else if (field.type === 'boolean') {
    segments.push('boolean()');
  } else if (field.type === 'phone') {
    // Same idiom the reference modules use: lenient about separators, strict about length.
    segments.push(
      'string()',
      'trim()',
      "regex(/^\\+?[0-9][0-9 .-]{6,19}$/, 'must be a phone number')",
    );
  } else {
    segments.push('string()', 'trim()');

    if (field.uppercase === true) {
      segments.push('toUpperCase()');
    }
  }

  if (field.min !== undefined && field.type !== 'date') {
    segments.push(`min(${numberLiteral(field.min)})`);
  }

  if (field.max !== undefined && field.type !== 'date') {
    segments.push(`max(${numberLiteral(field.max)})`);
  }

  if (field.pattern !== undefined) {
    const message = field.patternMessage === undefined ? '' : `, '${field.patternMessage}'`;
    segments.push(`regex(/${field.pattern}/${message})`);
  }

  if (field.patternFrom !== undefined) {
    segments.push(`regex(${field.patternFrom.export})`);
  }

  if (field.notInFuture === true) {
    segments.push("refine((value) => value.getTime() <= Date.now(), 'must not be in the future')");
  }

  if (field.nullable === true) {
    segments.push('nullable()');
  }

  if (field.optional === true) {
    segments.push('optional()');
  }

  return { head, segments };
}

function fieldLine(fieldName: string, field: BlueprintInputField, input: BlueprintInput): string {
  const chain = chainOf(field, input);
  const inline = `  ${fieldName}: ${chain.inline},`;

  if (inline.length <= PRINT_WIDTH) {
    return inline;
  }

  return [
    `  ${fieldName}: ${chain.head}`,
    ...chain.segments.map((segment, index) => {
      const comma = index === chain.segments.length - 1 ? ',' : '';
      return `    .${segment}${comma}`;
    }),
  ].join('\n');
}
