import type { Blueprint } from '../blueprint/schema';
import { emitControllerFile } from './emit-controller';
import { emitEventsFile } from './emit-events';
import { emitMongoSchemaFile } from './emit-mongo';
import { emitMongoRepositoryFile } from './emit-mongo-repository';
import { emitModuleFile } from './emit-module';
import { emitPrismaRepositoryFile } from './emit-prisma-repository';
import { emitRepositoryFile } from './emit-repository';
import { emitSchemasFile } from './emit-schemas';
import { emitTypesFile } from './emit-types';

export interface GeneratedFile {
  /** Project-relative path, POSIX separators. */
  path: string;
  content: string;
}

/**
 * The "domain" wave: every fully mechanical file of a module. Each entry is rewritten whole
 * on every run — hand edits between generations do not survive, by design.
 */
export function domainFiles(blueprint: Blueprint): GeneratedFile[] {
  const name = blueprint.module.name;
  const base = `src/modules/${name}`;

  return [
    { path: `${base}/types/${name}.types.ts`, content: emitTypesFile(blueprint) },
    // No events, no file: an empty interface augmentation would lint as "matches anything".
    ...(Object.keys(blueprint.realtimeEvents).length === 0
      ? []
      : [{ path: `${base}/types/${name}.events.ts`, content: emitEventsFile(blueprint) }]),
    { path: `${base}/schemas/${name}.schemas.ts`, content: emitSchemasFile(blueprint) },
    { path: `${base}/repositories/${name}.repository.ts`, content: emitRepositoryFile(blueprint) },
    ...(blueprint.module.supportedProviders === 'sql'
      ? []
      : [
          {
            path: `${base}/repositories/mongo/${name}.schema.ts`,
            content: emitMongoSchemaFile(blueprint),
          },
        ]),
  ];
}

/**
 * The "module" wave: the generated files that complete a working module — controller, both
 * repository implementations and the composition root. Rewritten whole, like the domain wave.
 */
export function moduleFiles(blueprint: Blueprint): GeneratedFile[] {
  const name = blueprint.module.name;
  const base = `src/modules/${name}`;
  const providers = blueprint.module.supportedProviders;

  return [
    { path: `${base}/controllers/${name}.controller.ts`, content: emitControllerFile(blueprint) },
    ...(providers === 'mongo'
      ? []
      : [
          {
            path: `${base}/repositories/sql/${name}.prisma.repository.ts`,
            content: emitPrismaRepositoryFile(blueprint),
          },
        ]),
    ...(providers === 'sql'
      ? []
      : [
          {
            path: `${base}/repositories/mongo/${name}.mongo.repository.ts`,
            content: emitMongoRepositoryFile(blueprint),
          },
        ]),
    { path: `${base}/${name}.module.ts`, content: emitModuleFile(blueprint) },
  ];
}

export { emitPrismaBlock } from './emit-prisma';
export { upsertManifestModule } from './manifest-region';
export { endMarker, startMarker, upsertPrismaRegion } from './prisma-region';
export { skeletonFiles } from './skeletons';
