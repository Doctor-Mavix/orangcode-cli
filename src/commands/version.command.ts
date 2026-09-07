import { writeOut } from '../output';
import { CLI_VERSION } from '../version';
import type { Command } from './command';

export class VersionCommand implements Command {
  readonly name = 'version';
  readonly summary = 'Print the CLI version.';

  run(): number {
    writeOut(`orangcode ${CLI_VERSION}`);
    return 0;
  }
}
