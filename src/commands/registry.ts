import { CliError } from '../errors';
import type { Command } from './command';

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [i];

    for (let j = 1; j <= b.length; j += 1) {
      const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + substitution,
      );
    }

    previous = current;
  }

  return previous[b.length] ?? 0;
}

const SUGGESTION_MAX_DISTANCE = 2;

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  register(command: Command): void {
    if (this.commands.has(command.name)) {
      throw new Error(`Command "${command.name}" is registered twice.`);
    }

    this.commands.set(command.name, command);
  }

  list(): Command[] {
    return [...this.commands.values()];
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }

  /** Routes a name to its command; an unknown name fails with the closest registered name. */
  resolve(name: string): Command {
    const command = this.commands.get(name);

    if (command !== undefined) {
      return command;
    }

    const suggestion = this.closest(name);
    const hint = suggestion === null ? '' : ` Did you mean "${suggestion}"?`;

    throw new CliError(
      `Unknown command "${name}".${hint} Run "orangcode help" to list the available commands.`,
    );
  }

  private closest(name: string): string | null {
    let best: { name: string; distance: number } | null = null;

    for (const candidate of this.commands.keys()) {
      const distance = levenshtein(name, candidate);

      if (distance <= SUGGESTION_MAX_DISTANCE && (best === null || distance < best.distance)) {
        best = { name: candidate, distance };
      }
    }

    return best === null ? null : best.name;
  }
}
