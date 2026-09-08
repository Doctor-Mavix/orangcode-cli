import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { z } from 'zod';

import { CliError } from '../errors';
import { writeOut } from '../output';

const definitionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'must be lowercase letters, digits and dashes'),
  description: z.string().min(1),
  run: z.string().min(1, 'declare a script ("./run.mjs") or a shell line ("shell: ...")'),
});

export type CustomCommand =
  | { kind: 'runnable'; name: string; description: string; directory: string; run: string }
  | { kind: 'doc'; name: string; description: string; docPath: string };

/**
 * Scans .orangcode/commands/: a `<name>/command.json` directory is a runnable command,
 * a lone `<name>.md` file is documentation the CLI lists but never executes.
 */
export function discoverCustomCommands(projectDir: string): CustomCommand[] {
  const commandsDir = join(projectDir, '.orangcode', 'commands');

  if (!existsSync(commandsDir)) {
    return [];
  }

  const commands: CustomCommand[] = [];

  for (const entry of readdirSync(commandsDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const definitionPath = join(commandsDir, entry.name, 'command.json');

      if (!existsSync(definitionPath)) {
        continue;
      }

      commands.push(readDefinition(definitionPath, entry.name, join(commandsDir, entry.name)));
    } else if (entry.name.endsWith('.md') && entry.name !== 'README.md') {
      const docPath = join(commandsDir, entry.name);
      commands.push({
        kind: 'doc',
        name: basename(entry.name, '.md'),
        description: firstMarkdownLine(docPath),
        docPath,
      });
    }
  }

  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

export function findCustomCommand(projectDir: string, name: string): CustomCommand | null {
  return discoverCustomCommands(projectDir).find((command) => command.name === name) ?? null;
}

/**
 * Custom commands are project-authored code: they only ever run after an explicit yes —
 * either --yes on the command line or an interactive confirmation on a TTY.
 */
export async function runCustomCommand(
  projectDir: string,
  command: CustomCommand,
  args: readonly string[],
): Promise<number> {
  if (command.kind === 'doc') {
    throw new CliError(
      `"${command.name}" is documentation, not a runnable command — read ${command.docPath}.`,
    );
  }

  const forwarded = args.filter((arg) => arg !== '--yes');
  const confirmed = args.includes('--yes') || (await askOnTty(command));

  if (!confirmed) {
    throw new CliError(
      `Custom command "${command.name}" was not confirmed — re-run with --yes to approve ` +
        `running it (its definition lives in .orangcode/commands/${command.name}/command.json).`,
    );
  }

  writeOut(`Running custom command "${command.name}" — ${command.description}`);

  if (command.run.startsWith('shell: ')) {
    const line = command.run.slice('shell: '.length);
    const result = spawnSync(line, { shell: true, cwd: projectDir, stdio: 'inherit' });
    return result.status ?? 1;
  }

  const script = resolve(command.directory, command.run);

  if (!script.startsWith(command.directory + sep)) {
    throw new CliError(
      `Custom command "${command.name}" points outside its own directory (${command.run}) — ` +
        `a command's script must live under .orangcode/commands/${command.name}/.`,
    );
  }

  if (!existsSync(script)) {
    throw new CliError(`Custom command "${command.name}": script not found at ${script}.`);
  }

  const result = spawnSync(process.execPath, [script, ...forwarded], {
    cwd: projectDir,
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

function readDefinition(definitionPath: string, dirName: string, directory: string): CustomCommand {
  let raw: unknown;

  try {
    raw = JSON.parse(readFileSync(definitionPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(`${definitionPath} is not valid JSON (${detail}).`);
  }

  const parsed = definitionSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new CliError(`${definitionPath} is not a valid command definition (${issues}).`);
  }

  if (parsed.data.name !== dirName) {
    throw new CliError(
      `${definitionPath} declares name "${parsed.data.name}" but lives in directory ` +
        `"${dirName}" — the two must match.`,
    );
  }

  return { kind: 'runnable', directory, ...parsed.data };
}

async function askOnTty(command: CustomCommand & { kind: 'runnable' }): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const answer = await rl.question(
      `Run custom command "${command.name}" (${command.run})? [y/N] `,
    );
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

function firstMarkdownLine(docPath: string): string {
  for (const line of readFileSync(docPath, 'utf8').split('\n')) {
    const text = line.replace(/^#+\s*/, '').trim();

    if (text !== '') {
      return text;
    }
  }

  return 'Documentation.';
}
