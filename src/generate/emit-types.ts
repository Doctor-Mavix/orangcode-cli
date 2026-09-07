import type { Blueprint } from '../blueprint/schema';
import { transitionTargets } from '../blueprint/schema';
import { enumConstName, upperSnakeCase } from './naming';
import { PRINT_WIDTH, jsdoc, ownedChildren, tsFieldType } from './model';

/** `types/<module>.types.ts` — enums, aliases, entities and the state machine. */
export function emitTypesFile(blueprint: Blueprint): string {
  const sections: string[] = [
    [
      '/**',
      ' * The domain vocabulary of the module. Nothing here imports Prisma or Mongoose: both',
      ' * repositories translate their engine rows into these shapes, which is what makes the',
      ' * DB_PROVIDER switch invisible to the service and the controller.',
      ' */',
    ].join('\n'),
  ];

  for (const [enumName, values] of Object.entries(blueprint.enums)) {
    sections.push(`${enumConst(enumName, values)}\n${enumType(enumName)}`);
  }

  for (const [aliasName, alias] of Object.entries(blueprint.aliases ?? {})) {
    const doc = alias.doc === undefined ? '' : `${jsdoc(alias.doc)}\n`;
    sections.push(`${doc}export type ${aliasName} = string;`);
  }

  const entities = Object.entries(blueprint.entities);

  entities.forEach(([entityName, entity], index) => {
    const lines: string[] = [];

    if (index === 0) {
      lines.push(
        '/**',
        ' * Absent values are `null` rather than optional: `exactOptionalPropertyTypes` makes',
        ' * `field?: string` and `field: undefined` two different things, and a database row that',
        ' * has no value is an explicit null on both engines.',
        ' */',
      );
    }

    lines.push(`export interface ${entityName} {`, '  id: string;');

    for (const [fieldName, field] of Object.entries(entity.fields)) {
      lines.push(`  ${fieldName}: ${tsFieldType(field)};`);
    }

    if (entity.timestamps === true || entity.timestamps === 'createdAt') {
      lines.push('  createdAt: Date;');
    }

    if (entity.timestamps === true) {
      lines.push('  updatedAt: Date;');
    }

    lines.push('}');
    sections.push(lines.join('\n'));
  });

  for (const [entityName] of entities) {
    const children = ownedChildren(blueprint, entityName);

    if (children.length === 0) {
      continue;
    }

    const lines = [
      `export interface ${entityName}Detail extends ${entityName} {`,
      ...children.map((child) => `  ${child.as}: ${child.name}[];`),
      '}',
    ];
    sections.push(lines.join('\n'));
  }

  if (blueprint.stateMachine !== undefined) {
    sections.push(...stateMachineSections(blueprint));
  }

  return `${sections.join('\n\n')}\n`;
}

function enumConst(enumName: string, values: string[]): string {
  const constName = enumConstName(enumName);
  const inline = `export const ${constName} = [${values.map(quote).join(', ')}] as const;`;

  if (inline.length <= PRINT_WIDTH) {
    return inline;
  }

  return [
    `export const ${constName} = [`,
    ...values.map((value) => `  ${quote(value)},`),
    '] as const;',
  ].join('\n');
}

function enumType(enumName: string): string {
  return `export type ${enumName} = (typeof ${enumConstName(enumName)})[number];`;
}

function stateMachineSections(blueprint: Blueprint): string[] {
  const stateMachine = blueprint.stateMachine;

  if (stateMachine === undefined) {
    return [];
  }

  const [entityName = '', fieldName = ''] = stateMachine.field.split('.');
  const enumType = blueprint.entities[entityName]?.fields[fieldName]?.type ?? '';
  const enumName = enumType.slice('enum:'.length);
  const constName = `${upperSnakeCase(fieldName)}_TRANSITIONS`;

  const lines = [
    '/**',
    ` * Allowed ${fieldName} transitions. Encoding them here rather than as scattered \`if\`s means an`,
    ' * illegal move is rejected identically wherever it comes from, and adding a state is a',
    ' * one-line change with a compiler-checked exhaustive key set.',
    ' */',
    `export const ${constName}: Record<${enumName}, readonly ${enumName}[]> = {`,
  ];

  for (const [from, entry] of Object.entries(stateMachine.transitions)) {
    if (!Array.isArray(entry)) {
      for (const docLine of typeof entry.doc === 'string' ? [entry.doc] : entry.doc) {
        lines.push(`  // ${docLine}`);
      }
    }

    lines.push(`  ${from}: [${transitionTargets(entry).map(quote).join(', ')}],`);
  }

  lines.push('};');

  const guard = [
    `export function canTransition(from: ${enumName}, to: ${enumName}): boolean {`,
    `  return ${constName}[from].includes(to);`,
    '}',
  ].join('\n');

  return [lines.join('\n'), guard];
}

function quote(value: string): string {
  return `'${value}'`;
}
