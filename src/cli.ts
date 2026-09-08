import { buildRegistry } from './commands';
import { findCustomCommand, runCustomCommand } from './custom/custom-commands';
import { CliError } from './errors';
import { writeErr } from './output';

const [, , commandName = 'help', ...commandArgs] = process.argv;
const registry = buildRegistry();

try {
  if (registry.has(commandName)) {
    process.exitCode = await registry.resolve(commandName).run(commandArgs);
  } else {
    // Unknown names fall through to the project's custom commands (.orangcode/commands/).
    const custom = findCustomCommand(process.cwd(), commandName);

    if (custom === null) {
      registry.resolve(commandName);
    } else {
      process.exitCode = await runCustomCommand(process.cwd(), custom, commandArgs);
    }
  }
} catch (error) {
  if (error instanceof CliError) {
    writeErr(`Error: ${error.message}`);
  } else {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    writeErr(`Unexpected error: ${detail}`);
  }

  process.exitCode = 1;
}
