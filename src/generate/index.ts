import type { Blueprint } from '../blueprint/schema';
import { emitEventsFile } from './emit-events';
import { emitMongoSchemaFile } from './emit-mongo';
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
    { path: `${base}/types/${name}.events.ts`, content: emitEventsFile(blueprint) },
    { path: `${base}/schemas/${name}.schemas.ts`, content: emitSchemasFile(blueprint) },
    { path: `${base}/repositories/${name}.repository.ts`, content: emitRepositoryFile(blueprint) },
    {
      path: `${base}/repositories/mongo/${name}.schema.ts`,
      content: emitMongoSchemaFile(blueprint),
    },
  ];
}

export { emitPrismaBlock } from './emit-prisma';
export { endMarker, startMarker, upsertPrismaRegion } from './prisma-region';
