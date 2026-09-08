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

const MANIFEST = [
  "import type { AppModule } from '@core/module';",
  '/* orangcode:modules:imports:start */',
  "import { healthModule } from './health/health.module';",
  '/* orangcode:modules:imports:end */',
  '',
  'export const APP_MODULES: readonly AppModule[] = [',
  '  /* orangcode:modules:list:start */',
  '  healthModule,',
  '  /* orangcode:modules:list:end */',
  '];',
  '',
].join('\n');

function makeProject(name: string): string {
  const projectDir = join(workDir, name);
  mkdirSync(join(projectDir, 'prisma'), { recursive: true });
  mkdirSync(join(projectDir, 'src', 'modules'), { recursive: true });
  writeFileSync(
    join(projectDir, 'prisma', 'schema.prisma'),
    'datasource db {\n  provider = "postgresql"\n}\n',
  );
  writeFileSync(join(projectDir, 'src', 'modules', 'index.ts'), MANIFEST);
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

  it('writes the module wave, registers the module and lays down the skeletons', () => {
    const projectDir = makeProject('module-wave');
    const code = new GenerateCommand().run(['module', BLUEPRINT_PATH, '--project', projectDir]);

    expect(code).toBe(0);
    expect(
      existsSync(join(projectDir, 'src/modules/complaint/controllers/complaint.controller.ts')),
    ).toBe(true);
    expect(existsSync(join(projectDir, 'src/modules/complaint/complaint.module.ts'))).toBe(true);
    expect(
      existsSync(
        join(projectDir, 'src/modules/complaint/repositories/sql/complaint.prisma.repository.ts'),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(projectDir, 'src/modules/complaint/repositories/mongo/complaint.mongo.repository.ts'),
      ),
    ).toBe(true);
    expect(
      existsSync(join(projectDir, 'src/modules/complaint/services/complaint.service.ts')),
    ).toBe(true);
    expect(existsSync(join(projectDir, 'src/modules/complaint/i18n/en.json'))).toBe(true);

    const manifest = readFileSync(join(projectDir, 'src', 'modules', 'index.ts'), 'utf8');
    expect(manifest).toContain("import { complaintModule } from './complaint/complaint.module';");
    expect(manifest).toContain('  complaintModule,');
  });

  it('never rewrites a skeleton: hand-written files survive the second run', () => {
    const projectDir = makeProject('skeletons');
    const command = new GenerateCommand();

    expect(command.run(['module', BLUEPRINT_PATH, '--project', projectDir])).toBe(0);

    const servicePath = join(projectDir, 'src/modules/complaint/services/complaint.service.ts');
    const sentinel = '// hand-written: the generator must not touch this file\n';
    writeFileSync(servicePath, sentinel);

    expect(command.run(['module', BLUEPRINT_PATH, '--project', projectDir])).toBe(0);
    expect(readFileSync(servicePath, 'utf8')).toBe(sentinel);
  });

  it('keeps the manifest stable: a second run changes nothing between the markers', () => {
    const projectDir = makeProject('manifest');
    const command = new GenerateCommand();
    const manifestPath = join(projectDir, 'src', 'modules', 'index.ts');

    expect(command.run(['module', BLUEPRINT_PATH, '--project', projectDir])).toBe(0);
    const first = readFileSync(manifestPath, 'utf8');

    expect(command.run(['module', BLUEPRINT_PATH, '--project', projectDir])).toBe(0);
    expect(readFileSync(manifestPath, 'utf8')).toBe(first);
  });

  it('keeps prisma untouched and skips the SQL repository for a mongo-only module', () => {
    const projectDir = makeProject('mongo-only');
    const blueprintPath = join(workDir, 'note.blueprint.json');
    writeFileSync(
      blueprintPath,
      JSON.stringify({
        schemaVersion: 1,
        module: {
          name: 'note',
          supportedProviders: 'mongo',
          transactionalGroup: null,
          dependsOn: [],
          softDeleteModels: [],
        },
        enums: {},
        entities: { Note: { fields: { title: { type: 'string' } }, timestamps: true } },
        repository: {
          operations: ['create', 'findById', 'list', 'update'],
          extraFinders: [],
          filter: [],
          patch: ['title'],
        },
        inputs: {},
        routes: [{ method: 'get', path: '/' }],
        kit: [],
        realtimeEvents: {},
        i18n: false,
      }),
    );
    const before = readFileSync(join(projectDir, 'prisma', 'schema.prisma'), 'utf8');

    expect(new GenerateCommand().run(['module', blueprintPath, '--project', projectDir])).toBe(0);

    expect(readFileSync(join(projectDir, 'prisma', 'schema.prisma'), 'utf8')).toBe(before);
    expect(
      existsSync(join(projectDir, 'src/modules/note/repositories/sql/note.prisma.repository.ts')),
    ).toBe(false);
    expect(
      existsSync(join(projectDir, 'src/modules/note/repositories/mongo/note.mongo.repository.ts')),
    ).toBe(true);
    expect(stdout.join('')).not.toContain('schema.prisma');
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
