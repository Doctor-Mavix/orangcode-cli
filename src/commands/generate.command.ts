import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { loadBlueprintFile } from '../blueprint/load';
import { blueprintSchema, formatIssuePath } from '../blueprint/schema';
import { CliError } from '../errors';
import { domainFiles, emitPrismaBlock, upsertPrismaRegion } from '../generate';
import { writeErr, writeOut } from '../output';
import type { Command } from './command';

const USAGE =
  'Usage: orangcode generate module <path/to/module.blueprint.json> [--project <dir>] [--only domain]';

interface GenerateOptions {
  blueprintPath: string;
  projectDir: string;
  only: 'domain';
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

    const blueprint = result.data;

    for (const file of domainFiles(blueprint)) {
      const target = join(options.projectDir, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content);
      writeOut(`generated ${file.path}`);
    }

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
    writeOut(`Module "${blueprint.module.name}" generated (${options.only} wave).`);
    return 0;
  }
}

function parseOptions(args: readonly string[]): GenerateOptions {
  let blueprintPath: string | undefined;
  let projectDir = process.cwd();
  let only = 'domain' as const;

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
          `Unsupported --only value "${value ?? ''}" — this version generates the "domain" wave only.`,
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
