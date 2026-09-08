import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CliError } from '../errors';
import { discoverCustomCommands, findCustomCommand, runCustomCommand } from './custom-commands';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'orangcode-custom-'));
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function commandsDir(): string {
  const dir = join(projectDir, '.orangcode', 'commands');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeCommand(name: string, definition: unknown): void {
  const dir = join(commandsDir(), name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'command.json'), JSON.stringify(definition, null, 2));
}

describe('discoverCustomCommands', () => {
  it('returns an empty list when the project has no commands directory', () => {
    expect(discoverCustomCommands(projectDir)).toEqual([]);
  });

  it('finds runnable commands and documentation-only entries, ignoring README.md', () => {
    writeCommand('seed', {
      name: 'seed',
      description: 'Seed the database with fixtures.',
      run: 'shell: node scripts/seed.mjs',
    });
    writeFileSync(join(commandsDir(), 'backup.md'), '# backup\n\nHow we back up.\n');
    writeFileSync(join(commandsDir(), 'README.md'), '# not a command\n');

    const commands = discoverCustomCommands(projectDir);

    expect(commands.map((command) => command.name).sort()).toEqual(['backup', 'seed']);
    const seed = commands.find((command) => command.name === 'seed');
    expect(seed?.kind).toBe('runnable');
    expect(seed?.description).toBe('Seed the database with fixtures.');
    const backup = commands.find((command) => command.name === 'backup');
    expect(backup?.kind).toBe('doc');
  });

  it('rejects a command.json whose name does not match its directory', () => {
    writeCommand('deploy', { name: 'other', description: 'x', run: 'shell: true' });

    expect(() => discoverCustomCommands(projectDir)).toThrow(CliError);
    expect(() => discoverCustomCommands(projectDir)).toThrow(/deploy/);
  });

  it('rejects a command.json that declares neither a script nor a shell line', () => {
    writeCommand('broken', { name: 'broken', description: 'x', run: '' });

    expect(() => discoverCustomCommands(projectDir)).toThrow(CliError);
  });
});

describe('findCustomCommand', () => {
  it('resolves a runnable command by name and returns null for the rest', () => {
    writeCommand('seed', { name: 'seed', description: 'x', run: 'shell: true' });
    writeFileSync(join(commandsDir(), 'backup.md'), '# backup\n');

    expect(findCustomCommand(projectDir, 'seed')?.name).toBe('seed');
    expect(findCustomCommand(projectDir, 'missing')).toBe(null);
  });
});

describe('runCustomCommand', () => {
  it('refuses to run without confirmation when stdin is not a TTY', async () => {
    writeCommand('seed', { name: 'seed', description: 'x', run: 'shell: true' });
    const command = findCustomCommand(projectDir, 'seed');

    await expect(runCustomCommand(projectDir, command!, [])).rejects.toThrow(/--yes/);
  });

  it('runs a shell command from the project root once confirmed with --yes', async () => {
    writeCommand('touch', {
      name: 'touch',
      description: 'Touch a marker file.',
      run: 'shell: node -e "require(\'node:fs\').writeFileSync(\'marker.txt\', \'ran\')"',
    });
    const command = findCustomCommand(projectDir, 'touch');

    const code = await runCustomCommand(projectDir, command!, ['--yes']);

    expect(code).toBe(0);
    expect(existsSync(join(projectDir, 'marker.txt'))).toBe(true);
  });

  it('runs a script with node, forwards the arguments and propagates the exit code', async () => {
    const dir = join(commandsDir(), 'exit');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'command.json'),
      JSON.stringify({ name: 'exit', description: 'x', run: './run.mjs' }),
    );
    writeFileSync(join(dir, 'run.mjs'), 'process.exit(Number(process.argv[2]));\n');
    const command = findCustomCommand(projectDir, 'exit');

    await expect(runCustomCommand(projectDir, command!, ['7', '--yes'])).resolves.toBe(7);
  });

  it('refuses a script that escapes the command directory', async () => {
    writeCommand('escape', { name: 'escape', description: 'x', run: '../../../run.mjs' });
    const command = findCustomCommand(projectDir, 'escape');

    await expect(runCustomCommand(projectDir, command!, ['--yes'])).rejects.toThrow(CliError);
  });
});
