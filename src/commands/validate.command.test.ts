import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CliError } from '../errors';
import { ValidateCommand } from './validate.command';

const EXAMPLE_PATH = fileURLToPath(
  new URL('../../examples/complaint.blueprint.json', import.meta.url),
);

const workDir = mkdtempSync(join(tmpdir(), 'orangcode-cli-validate-'));

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validate command (end to end)', () => {
  it('accepts the example complaint blueprint', () => {
    const code = new ValidateCommand().run([EXAMPLE_PATH]);

    expect(code).toBe(0);
    expect(stdout.join('')).toContain('valid blueprint (module "complaint")');
  });

  it('lists every error of a broken blueprint, each with its JSON path', () => {
    const example = JSON.parse(readFileSync(EXAMPLE_PATH, 'utf8')) as Record<string, unknown>;
    const entities = example['entities'] as Record<
      string,
      { fields: Record<string, Record<string, unknown>> }
    >;
    entities['Complaint']!.fields['status']!['type'] = 'enum:Missing';
    const repository = example['repository'] as { extraFinders: { name: string; by: string }[] };
    repository.extraFinders = [{ name: 'findByCode', by: 'code' }];

    const filePath = join(workDir, 'broken.blueprint.json');
    writeFileSync(filePath, JSON.stringify(example));

    const code = new ValidateCommand().run([filePath]);
    const output = stderr.join('');

    expect(code).toBe(1);
    expect(output).toContain('2 error(s)');
    expect(output).toContain('entities.Complaint.fields.status.type');
    expect(output).toContain('repository.extraFinders[0].by');
  });

  it('fails with usage when the blueprint argument is missing', () => {
    const code = new ValidateCommand().run([]);

    expect(code).toBe(1);
    expect(stderr.join('')).toContain('Usage: orangcode validate');
  });

  it('propagates a readable CliError for a missing file', () => {
    const filePath = join(workDir, 'nope.blueprint.json');

    expect(() => new ValidateCommand().run([filePath])).toThrow(CliError);
    expect(() => new ValidateCommand().run([filePath])).toThrow(/not found/);
  });
});
