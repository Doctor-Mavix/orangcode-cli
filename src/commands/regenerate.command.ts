import { join } from 'node:path';

import { loadBlueprintFile } from '../blueprint/load';
import { blueprintSchema, formatIssuePath } from '../blueprint/schema';
import { CliError } from '../errors';
import { readProjectManifest } from '../manifest/project-manifest';
import { writeOut } from '../output';
import type { Command } from './command';
import { runGeneration } from './generate.command';

const USAGE = 'Usage: orangcode regenerate [module] [--project <dir>]';

interface RegenerateOptions {
  module: string | undefined;
  projectDir: string;
}

export class RegenerateCommand implements Command {
  readonly name = 'regenerate';
  readonly summary =
    'Rebuild every generated file from the blueprints recorded in .orangcode/manifest.json.';

  run(args: readonly string[]): number {
    const options = parseOptions(args);
    const manifest = readProjectManifest(options.projectDir);

    if (manifest.blueprints.length === 0) {
      writeOut(
        'No module recorded in .orangcode/manifest.json yet — run "orangcode generate module" first.',
      );
      return 0;
    }

    const entries =
      options.module === undefined
        ? manifest.blueprints
        : manifest.blueprints.filter((entry) => entry.module === options.module);

    if (entries.length === 0) {
      const known = manifest.blueprints.map((entry) => entry.module).join(', ');
      throw new CliError(
        `No module "${options.module ?? ''}" in .orangcode/manifest.json — recorded modules: ${known}.`,
      );
    }

    for (const entry of entries) {
      const blueprintPath = join(options.projectDir, entry.blueprint);
      const data = loadBlueprintFile(blueprintPath);
      const result = blueprintSchema.safeParse(data);

      if (!result.success) {
        const issues = result.error.issues
          .map((issue) => `  - ${formatIssuePath(issue.path)}: ${issue.message}`)
          .join('\n');
        throw new CliError(
          `"${entry.blueprint}" is no longer a valid blueprint:\n${issues}\n` +
            `Fix it (or run "orangcode validate" on it), then regenerate again.`,
        );
      }

      runGeneration(result.data, { blueprintPath, projectDir: options.projectDir, only: 'all' });
      writeOut(`Module "${entry.module}" regenerated.`);
    }

    return 0;
  }
}

function parseOptions(args: readonly string[]): RegenerateOptions {
  let module: string | undefined;
  let projectDir = process.cwd();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--project') {
      const value = args[index + 1];

      if (value === undefined) {
        throw new CliError(`Missing value after --project.\n${USAGE}`);
      }

      projectDir = value;
      index += 1;
    } else if (arg?.startsWith('--') === true) {
      throw new CliError(`Unknown option "${arg}".\n${USAGE}`);
    } else if (module === undefined && arg !== undefined) {
      module = arg;
    } else {
      throw new CliError(`Unexpected argument "${arg ?? ''}".\n${USAGE}`);
    }
  }

  return { module, projectDir };
}
