import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { loadBlueprintFile } from '../blueprint/load';
import { blueprintSchema, formatIssuePath } from '../blueprint/schema';
import type { Blueprint } from '../blueprint/schema';
import { CliError } from '../errors';
import {
  domainFiles,
  emitPrismaBlock,
  moduleFiles,
  skeletonFiles,
  upsertManifestModule,
  upsertPrismaRegion,
} from '../generate';
import {
  readProjectManifest,
  upsertBlueprintEntry,
  writeProjectManifest,
} from '../manifest/project-manifest';
import type { ProjectManifest } from '../manifest/project-manifest';
import { writeErr, writeOut } from '../output';
import type { Command } from './command';

const USAGE =
  'Usage: orangcode generate module <path/to/module.blueprint.json> [--project <dir>] [--only domain]';

export interface GenerationRequest {
  blueprintPath: string;
  projectDir: string;
  only: 'all' | 'domain';
}

export class GenerateCommand implements Command {
  readonly name = 'generate';
  readonly summary = 'Generate the mechanical files of a module from its blueprint.';

  run(args: readonly string[]): number {
    const [subcommand, ...rest] = args;

    if (subcommand !== 'module') {
      writeErr(
        subcommand === undefined
          ? 'Missing subcommand.'
          : `Unknown subcommand "${subcommand}" — only "module" exists for now.`,
      );
      writeErr(USAGE);
      return 1;
    }

    const options = parseOptions(rest);
    const data = loadBlueprintFile(options.blueprintPath);
    const result = blueprintSchema.safeParse(data);

    if (!result.success) {
      writeErr(`"${options.blueprintPath}" is not a valid blueprint:`);

      for (const issue of result.error.issues) {
        writeErr(`  - ${formatIssuePath(issue.path)}: ${issue.message}`);
      }

      writeErr('Fix the blueprint (or run "orangcode validate" on it), then generate again.');
      return 1;
    }

    runGeneration(result.data, options);
    writeOut(
      options.only === 'domain'
        ? `Module "${result.data.module.name}" generated (domain wave).`
        : `Module "${result.data.module.name}" generated.`,
    );
    return 0;
  }
}

/**
 * The shared generation core: writes both waves, lays down missing skeletons, updates the
 * module index and the prisma region, then records the module in .orangcode/manifest.json.
 */
export function runGeneration(blueprint: Blueprint, options: GenerationRequest): void {
  // Read before writing a single file: pointing --project at a non-project directory
  // must fail without leaving half a module behind.
  const projectManifest = readProjectManifest(options.projectDir);
  const files =
    options.only === 'domain'
      ? domainFiles(blueprint)
      : [...domainFiles(blueprint), ...moduleFiles(blueprint)];
  const generatedHashes: Record<string, string> = {};

  for (const file of files) {
    const target = join(options.projectDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
    generatedHashes[file.path] = createHash('sha256').update(file.content).digest('hex');
    writeOut(`generated ${file.path}`);
  }

  if (options.only === 'all') {
    // Skeletons are created once and belong to the developer from then on.
    for (const file of skeletonFiles(blueprint)) {
      const target = join(options.projectDir, file.path);

      if (existsSync(target)) {
        continue;
      }

      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content);
      writeOut(`created ${file.path} (skeleton — yours from now on)`);
    }

    const manifestPath = join(options.projectDir, 'src', 'modules', 'index.ts');

    if (!existsSync(manifestPath)) {
      throw new CliError(
        `No src/modules/index.ts under "${options.projectDir}". Point --project at the root of a project created from the template.`,
      );
    }

    const manifestSource = readFileSync(manifestPath, 'utf8');

    try {
      const updated = upsertManifestModule(manifestSource, blueprint.module.name);

      if (updated !== manifestSource) {
        writeFileSync(manifestPath, updated);
        writeOut(`updated src/modules/index.ts (module "${blueprint.module.name}")`);
      }
    } catch (error) {
      throw new CliError(error instanceof Error ? error.message : String(error));
    }
  }

  if (blueprint.module.supportedProviders !== 'mongo') {
    const prismaPath = join(options.projectDir, 'prisma', 'schema.prisma');

    if (!existsSync(prismaPath)) {
      throw new CliError(
        `No prisma/schema.prisma under "${options.projectDir}". Point --project at the root of a project created from the template.`,
      );
    }

    const source = readFileSync(prismaPath, 'utf8');

    try {
      writeFileSync(
        prismaPath,
        upsertPrismaRegion(source, blueprint.module.name, emitPrismaBlock(blueprint)),
      );
    } catch (error) {
      throw new CliError(error instanceof Error ? error.message : String(error));
    }

    writeOut(`generated prisma/schema.prisma (region "${blueprint.module.name}")`);
  }

  recordInProjectManifest(options, blueprint.module.name, projectManifest, generatedHashes);
}

function parseOptions(args: readonly string[]): GenerationRequest {
  let blueprintPath: string | undefined;
  let projectDir = process.cwd();
  let only: 'all' | 'domain' = 'all';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--project') {
      const value = args[index + 1];

      if (value === undefined) {
        throw new CliError(`Missing value after --project.\n${USAGE}`);
      }

      projectDir = value;
      index += 1;
    } else if (arg === '--only') {
      const value = args[index + 1];

      if (value !== 'domain') {
        throw new CliError(
          `Unsupported --only value "${value ?? ''}" — only "domain" restricts the run (the default generates everything).`,
        );
      }

      only = value;
      index += 1;
    } else if (arg?.startsWith('--') === true) {
      throw new CliError(`Unknown option "${arg}".\n${USAGE}`);
    } else if (blueprintPath === undefined && arg !== undefined) {
      blueprintPath = arg;
    } else {
      throw new CliError(`Unexpected argument "${arg ?? ''}".\n${USAGE}`);
    }
  }

  if (blueprintPath === undefined) {
    throw new CliError(`Missing <blueprint> argument.\n${USAGE}`);
  }

  return { blueprintPath, projectDir, only };
}

function recordInProjectManifest(
  options: GenerationRequest,
  moduleName: string,
  manifest: ProjectManifest,
  generatedHashes: Record<string, string>,
): void {
  const storedBlueprint = `.orangcode/blueprints/${moduleName}.blueprint.json`;
  const target = join(options.projectDir, storedBlueprint);

  if (resolve(options.blueprintPath) !== resolve(target)) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(options.blueprintPath));
    writeOut(`stored ${storedBlueprint}`);
  }

  const existing = manifest.blueprints.find((entry) => entry.module === moduleName);
  // A domain-only run rewrites part of the module: merge over the previous hashes instead
  // of forgetting the module-wave files a full run recorded.
  const generatedFiles =
    options.only === 'domain' && existing !== undefined
      ? { ...existing.generatedFiles, ...generatedHashes }
      : generatedHashes;

  writeProjectManifest(
    options.projectDir,
    upsertBlueprintEntry(manifest, {
      module: moduleName,
      blueprint: storedBlueprint,
      generatedFiles,
    }),
  );
  writeOut(`updated .orangcode/manifest.json (module "${moduleName}")`);
}
