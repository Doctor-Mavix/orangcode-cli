import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CliError } from '../errors';
import { GenerateCommand } from './generate.command';

const BLUEPRINT_PATH = fileURLToPath(
  new URL('../../examples/complaint.blueprint.json', import.meta.url),
);

const workDir = mkdtempSync(join(tmpdir(), 'orangcode-cli-generate-'));

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

function makeProject(name: string): string {
  const projectDir = join(workDir, name);
  mkdirSync(join(projectDir, 'prisma'), { recursive: true });
  writeFileSync(
    join(projectDir, 'prisma', 'schema.prisma'),
    'datasource db {\n  provider = "postgresql"\n}\n',
  );
  return projectDir;
}

describe('generate command (end to end)', () => {
  it('writes every domain file and the prisma region into the project', () => {
    const projectDir = makeProject('fresh');
    const code = new GenerateCommand().run([
      'module',
      BLUEPRINT_PATH,
      '--project',
      projectDir,
      '--only',
      'domain',
    ]);

    expect(code).toBe(0);
    expect(existsSync(join(projectDir, 'src/modules/complaint/types/complaint.types.ts'))).toBe(
      true,
    );
    expect(
      existsSync(join(projectDir, 'src/modules/complaint/repositories/mongo/complaint.schema.ts')),
    ).toBe(true);

    const schema = readFileSync(join(projectDir, 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).toContain('/// orangcode:models:complaint:start');
    expect(schema).toContain('model ComplaintEvent {');
    expect(stdout.join('')).toContain('generated src/modules/complaint/types/complaint.types.ts');
  });

  it('is idempotent on disk: a second run leaves every byte in place', () => {
    const projectDir = makeProject('twice');
    const command = new GenerateCommand();
    const paths = [
      'src/modules/complaint/schemas/complaint.schemas.ts',
      'prisma/schema.prisma',
    ].map((path) => join(projectDir, path));

    expect(command.run(['module', BLUEPRINT_PATH, '--project', projectDir])).toBe(0);
    const first = paths.map((path) => readFileSync(path, 'utf8'));

    expect(command.run(['module', BLUEPRINT_PATH, '--project', projectDir])).toBe(0);
    const second = paths.map((path) => readFileSync(path, 'utf8'));

    expect(second).toEqual(first);
  });

  it('rejects an invalid blueprint with its JSON paths', () => {
    const projectDir = makeProject('invalid');
    const broken = JSON.parse(readFileSync(BLUEPRINT_PATH, 'utf8')) as Record<string, unknown>;
    broken['schemaVersion'] = 2;
    const blueprintPath = join(projectDir, 'broken.blueprint.json');
    writeFileSync(blueprintPath, JSON.stringify(broken));

    const code = new GenerateCommand().run(['module', blueprintPath, '--project', projectDir]);

    expect(code).toBe(1);
    expect(stderr.join('')).toContain('schemaVersion');
  });

  it('refuses a project without a prisma schema', () => {
    const projectDir = join(workDir, 'no-prisma');
    mkdirSync(projectDir, { recursive: true });

    expect(() =>
      new GenerateCommand().run(['module', BLUEPRINT_PATH, '--project', projectDir]),
    ).toThrow(CliError);
  });

  it('fails with usage when the subcommand or the blueprint is missing', () => {
    expect(new GenerateCommand().run([])).toBe(1);
    expect(stderr.join('')).toContain('Usage: orangcode generate module');
    expect(() => new GenerateCommand().run(['module'])).toThrow(/Missing <blueprint>/);
  });

  it('rejects an unsupported --only value', () => {
    expect(() => new GenerateCommand().run(['module', BLUEPRINT_PATH, '--only', 'all'])).toThrow(
      /--only value "all"/,
    );
  });
});
