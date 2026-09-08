import { CliError } from '../errors';
import { discoverCustomCommands } from '../custom/custom-commands';
import { writeOut } from '../output';
import type { Command } from './command';
import type { CommandRegistry } from './registry';

const USAGE = 'Usage: orangcode list [--project <dir>]';

export class ListCommand implements Command {
  readonly name = 'list';
  readonly summary = 'List the core commands and the custom commands of the project.';

  constructor(private readonly registry: CommandRegistry) {}

  run(args: readonly string[]): number {
    const projectDir = parseOptions(args);
    const core = this.registry.list();
    const custom = discoverCustomCommands(projectDir);
    const width = Math.max(
      ...core.map((command) => command.name.length),
      ...custom.map((command) => command.name.length),
    );

    writeOut('Core commands:');

    for (const command of core) {
      writeOut(`  ${command.name.padEnd(width)}  ${command.summary}`);
    }

    if (custom.length > 0) {
      writeOut('');
      writeOut('Custom commands (.orangcode/commands/):');

      for (const command of custom) {
        const suffix = command.kind === 'doc' ? ' (documentation only)' : '';
        writeOut(`  ${command.name.padEnd(width)}  ${command.description}${suffix}`);
      }
    }

    return 0;
  }
}

function parseOptions(args: readonly string[]): string {
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
    } else {
      throw new CliError(`Unexpected argument "${arg ?? ''}".\n${USAGE}`);
    }
  }

  return projectDir;
}
