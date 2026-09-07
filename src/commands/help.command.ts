import { writeOut } from '../output';
import type { Command } from './command';
import type { CommandRegistry } from './registry';

export class HelpCommand implements Command {
  readonly name = 'help';
  readonly summary = 'List the available commands.';

  constructor(private readonly registry: CommandRegistry) {}

  run(): number {
    const commands = this.registry.list();
    const width = Math.max(...commands.map((command) => command.name.length));

    writeOut('OrangCode CLI — blueprint validation and module generation.');
    writeOut('');
    writeOut('Usage: orangcode <command> [arguments]');
    writeOut('');
    writeOut('Commands:');

    for (const command of commands) {
      writeOut(`  ${command.name.padEnd(width)}  ${command.summary}`);
    }

    return 0;
  }
}
