import type { Blueprint } from '../blueprint/schema';
import type { GeneratedFile } from './index';
import { PRINT_WIDTH, rootEntity } from './model';
import { upperSnakeCase } from './naming';

/**
 * The hand-written half of a module: created once so a fresh module compiles and has a place
 * for its logic, then never touched again. The command only writes a skeleton whose file does
 * not exist yet.
 */
export function skeletonFiles(blueprint: Blueprint): GeneratedFile[] {
  const name = blueprint.module.name;
  const base = `src/modules/${name}`;
  const files: GeneratedFile[] = [
    { path: `${base}/services/${name}.service.ts`, content: serviceSkeleton(blueprint) },
    { path: `${base}/types/${name}.views.ts`, content: viewsSkeleton(blueprint) },
    { path: `${base}/tests/${name}.integration.test.ts`, content: testSkeleton(blueprint) },
  ];

  if (blueprint.i18n) {
    files.push(
      { path: `${base}/i18n/en.json`, content: '{}\n' },
      { path: `${base}/i18n/fr.json`, content: '{}\n' },
    );
  }

  return files;
}

function serviceSkeleton(blueprint: Blueprint): string {
  const root = rootEntity(blueprint);
  const name = blueprint.module.name;
  const token = `${upperSnakeCase(name)}_REPOSITORY`;
  // `protected`, not `private`: an untouched skeleton must pass noUnusedLocals.
  const param = `@inject(${token}) protected readonly repository: ${root.name}Repository`;
  const inline = `  constructor(${param}) {}`;

  return [
    "import { inject, injectable } from 'tsyringe';",
    '',
    `import { ${token} } from '../repositories/${name}.repository';`,
    `import type { ${root.name}Repository } from '../repositories/${name}.repository';`,
    '',
    '/**',
    ` * Hand-written business logic of the ${name} module. Generated once as a skeleton —`,
    ' * the generator never touches this file again.',
    ' */',
    '@injectable()',
    `export class ${root.name}Service {`,
    ...(inline.length <= PRINT_WIDTH ? [inline] : ['  constructor(', `    ${param},`, '  ) {}']),
    '}',
    '',
  ].join('\n');
}

function viewsSkeleton(blueprint: Blueprint): string {
  return [
    '/**',
    ` * Hand-written view types of the ${blueprint.module.name} module (public projections and other`,
    ' * service-owned shapes). Generated once — the generator never touches this file again.',
    ' */',
    'export {};',
    '',
  ].join('\n');
}

function testSkeleton(blueprint: Blueprint): string {
  const name = blueprint.module.name;

  return ["import { describe } from 'vitest';", '', `describe.todo('${name} module');`, ''].join(
    '\n',
  );
}
