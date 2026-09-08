import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildRegistry } from './index';
import { ListCommand } from './list.command';

let projectDir: string;
let stdout: string[];

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'orangcode-list-'));
  stdout = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('list command', () => {
  it('lists the core commands even outside a project', () => {
    expect(new ListCommand(buildRegistry()).run(['--project', projectDir])).toBe(0);

    const output = stdout.join('');
    expect(output).toContain('generate');
    expect(output).toContain('doctor');
    expect(output).not.toContain('Custom commands');
  });

  it('lists custom commands with their descriptions, doc-only entries marked', () => {
    const seedDir = join(projectDir, '.orangcode', 'commands', 'seed');
    mkdirSync(seedDir, { recursive: true });
    writeFileSync(
      join(seedDir, 'command.json'),
      JSON.stringify({ name: 'seed', description: 'Seed the database.', run: 'shell: true' }),
    );
    writeFileSync(
      join(projectDir, '.orangcode', 'commands', 'backup.md'),
      '# backup\n\nHow to back up.\n',
    );

    expect(new ListCommand(buildRegistry()).run(['--project', projectDir])).toBe(0);

    const output = stdout.join('');
    expect(output).toContain('Custom commands');
    expect(output).toContain('seed');
    expect(output).toContain('Seed the database.');
    expect(output).toMatch(/backup.*documentation/i);
  });
});
