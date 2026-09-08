import { GenerateCommand } from './generate.command';
import { HelpCommand } from './help.command';
import { CommandRegistry } from './registry';
import { RegenerateCommand } from './regenerate.command';
import { ValidateCommand } from './validate.command';
import { VersionCommand } from './version.command';

export function buildRegistry(): CommandRegistry {
  const registry = new CommandRegistry();

  registry.register(new ValidateCommand());
  registry.register(new GenerateCommand());
  registry.register(new RegenerateCommand());
  registry.register(new VersionCommand());
  registry.register(new HelpCommand(registry));

  return registry;
}
