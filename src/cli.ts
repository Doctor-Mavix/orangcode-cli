import { buildRegistry } from './commands';
import { CliError } from './errors';
import { writeErr } from './output';

const [, , commandName = 'help', ...commandArgs] = process.argv;
const registry = buildRegistry();

try {
  const command = registry.resolve(commandName);
  process.exitCode = await command.run(commandArgs);
} catch (error) {
  if (error instanceof CliError) {
    writeErr(`Error: ${error.message}`);
  } else {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    writeErr(`Unexpected error: ${detail}`);
  }

  process.exitCode = 1;
}
