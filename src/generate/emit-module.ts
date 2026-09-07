import type { Blueprint } from '../blueprint/schema';
import { dependencyDoc, dependencyName } from '../blueprint/schema';
import { PRINT_WIDTH, docLines, rootEntity } from './model';
import { camelCase, kebabPlural, upperSnakeCase } from './naming';

/**
 * `<module>.module.ts` — the composition root of the module: repository choice, dependency
 * checks and i18n registration. Everything here is derived, so the file is regenerated whole.
 */
export function emitModuleFile(blueprint: Blueprint): string {
  const root = rootEntity(blueprint);
  const rootName = root.name;
  const providers = blueprint.module.supportedProviders;

  const sections = [
    importSection(blueprint, rootName),
    createRepositorySection(rootName, providers),
    moduleSection(blueprint, rootName),
  ];

  return `${sections.join('\n\n')}\n`;
}

/** `notification` → `@shared/notifications/notification.tokens` / `NOTIFICATION_SERVICE`. */
function dependencyToken(name: string): { path: string; token: string } {
  return {
    path: `@shared/${kebabPlural(name)}/${name}.tokens`,
    token: `${upperSnakeCase(name)}_SERVICE`,
  };
}

function importSection(blueprint: Blueprint, rootName: string): string {
  const { module } = blueprint;
  const name = module.name;
  const providers = module.supportedProviders;
  const databaseNames = [
    ...(providers === 'both' || providers === 'mongo' ? ['mongoConnectionOf'] : []),
    ...(providers === 'both' || providers === 'sql' ? ['sqlClientOf'] : []),
  ];

  const lines = [`import { ${databaseNames.join(', ')} } from '@core/database';`];

  if (module.dependsOn.length > 0) {
    lines.push("import { ConfigurationError } from '@core/errors/app-error';");
  }

  lines.push("import type { AppModule, ModuleRegistration } from '@core/module';");

  for (const dependency of module.dependsOn) {
    const { path, token } = dependencyToken(dependencyName(dependency));
    lines.push(`import { ${token} } from '${path}';`);
  }

  if (blueprint.i18n) {
    lines.push("import { SHARED_TOKENS } from '@shared/tokens';");
  }

  if (Object.keys(blueprint.realtimeEvents).length > 0) {
    lines.push(`import './types/${name}.events';`);
  }

  if (blueprint.i18n) {
    lines.push(
      `import en from './i18n/en.json' with { type: 'json' };`,
      `import fr from './i18n/fr.json' with { type: 'json' };`,
    );
  }

  lines.push(
    `import { ${rootName}Controller } from './controllers/${name}.controller';`,
    `import { ${upperSnakeCase(name)}_REPOSITORY } from './repositories/${name}.repository';`,
    `import type { ${rootName}Repository } from './repositories/${name}.repository';`,
  );

  if (providers === 'both' || providers === 'mongo') {
    lines.push(
      `import { Mongo${rootName}Repository } from './repositories/mongo/${name}.mongo.repository';`,
    );
  }

  if (providers === 'both' || providers === 'sql') {
    lines.push(
      `import { Prisma${rootName}Repository } from './repositories/sql/${name}.prisma.repository';`,
    );
  }

  return lines.join('\n');
}

function createRepositorySection(rootName: string, providers: 'both' | 'sql' | 'mongo'): string {
  const header = `function createRepository(registration: ModuleRegistration): ${rootName}Repository {`;

  if (providers === 'sql') {
    return [
      header,
      `  return new Prisma${rootName}Repository(sqlClientOf(registration.adapter));`,
      '}',
    ].join('\n');
  }

  if (providers === 'mongo') {
    return [
      header,
      `  return new Mongo${rootName}Repository(mongoConnectionOf(registration.adapter));`,
      '}',
    ].join('\n');
  }

  return [
    header,
    '  const { provider, adapter } = registration;',
    '',
    "  return provider === 'mongodb'",
    `    ? new Mongo${rootName}Repository(mongoConnectionOf(adapter))`,
    `    : new Prisma${rootName}Repository(sqlClientOf(adapter));`,
    '}',
  ].join('\n');
}

function dependencyCheck(blueprint: Blueprint): string[] {
  const lines: string[] = [];

  for (const dependency of blueprint.module.dependsOn) {
    const name = dependencyName(dependency);
    const doc = dependencyDoc(dependency);
    const { token } = dependencyToken(name);
    const message = `The ${blueprint.module.name} module needs the ${name} module — add "${name}" to MODULES_ENABLED.`;
    const inlineThrow = `      throw new ConfigurationError('${message}');`;

    lines.push(
      '',
      ...(doc === undefined ? [] : docLines(doc).map((line) => `    // ${line}`)),
      `    if (!container.isRegistered(${token}, true)) {`,
      ...(inlineThrow.length <= PRINT_WIDTH
        ? [inlineThrow]
        : ['      throw new ConfigurationError(', `        '${message}',`, '      );']),
      '    }',
    );
  }

  return lines;
}

function moduleSection(blueprint: Blueprint, rootName: string): string {
  const { module } = blueprint;
  const doc =
    module.supportedProviders === 'both'
      ? [
          '/**',
          ' * The whole DB_PROVIDER switch, for this module, is the ternary above. Everything downstream',
          ` * — service, controller, HTTP contract — is written once against \`${rootName}Repository\`.`,
          ' */',
        ]
      : [];

  const token = `${upperSnakeCase(module.name)}_REPOSITORY`;
  const registerInline = `    container.registerInstance(${token}, createRepository(registration));`;
  const registration = [
    '  register(registration) {',
    '    const { container } = registration;',
    ...dependencyCheck(blueprint),
    '',
    ...(registerInline.length <= PRINT_WIDTH
      ? [registerInline]
      : [
          '    container.registerInstance(',
          `      ${token},`,
          '      createRepository(registration),',
          '    );',
        ]),
    ...(blueprint.i18n ? ['    container.resolve(SHARED_TOKENS.I18n).register({ en, fr });'] : []),
    '  },',
  ];

  return [
    ...doc,
    `export const ${camelCase(module.name)}Module: AppModule = {`,
    `  name: '${module.name}',`,
    `  controllers: [${rootName}Controller],`,
    ...(module.basePath === undefined ? [] : [`  mountPath: '${module.basePath}',`]),
    ...(module.transactionalGroup === null
      ? []
      : [`  transactionalGroup: '${module.transactionalGroup}',`]),
    ...(module.softDeleteModels.length > 0
      ? [
          `  softDeleteModels: [${module.softDeleteModels.map((model) => `'${model}'`).join(', ')}],`,
        ]
      : []),
    ...registration,
    '};',
  ].join('\n');
}
