import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DoctorCommand } from './doctor.command';
import { GenerateCommand } from './generate.command';

const BLUEPRINT_PATH = fileURLToPath(
  new URL('../../examples/complaint.blueprint.json', import.meta.url),
);

const workDir = mkdtempSync(join(tmpdir(), 'orangcode-cli-doctor-'));

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

let stdout: string[];

beforeEach(() => {
  stdout = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const MODULES_INDEX = [
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
  mkdirSync(join(projectDir, '.orangcode'), { recursive: true });
  writeFileSync(
    join(projectDir, 'prisma', 'schema.prisma'),
    'datasource db {\n  provider = "postgresql"\n}\n',
  );
  writeFileSync(join(projectDir, 'src', 'modules', 'index.ts'), MODULES_INDEX);
  writeFileSync(
    join(projectDir, '.orangcode', 'manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        template: 'express-typescript',
        templateVersion: '1.1.0',
        generatedBy: null,
        blueprints: [],
        supportedProviders: ['postgresql', 'mysql', 'mongodb'],
      },
      null,
      2,
    )}\n`,
  );
  return projectDir;
}

function makeGeneratedProject(name: string): string {
  const projectDir = makeProject(name);
  expect(new GenerateCommand().run(['module', BLUEPRINT_PATH, '--project', projectDir])).toBe(0);
  stdout = [];
  return projectDir;
}

describe('doctor command', () => {
  it('gives a healthy generated project a clean bill', () => {
    const projectDir = makeGeneratedProject('healthy');

    expect(new DoctorCommand().run(['--project', projectDir])).toBe(0);
    expect(stdout.join('')).toContain('complaint');
  });

  it('flags a hand-edited generated file and says the edit will be lost', () => {
    const projectDir = makeGeneratedProject('edited');
    const typesPath = 'src/modules/complaint/types/complaint.types.ts';
    writeFileSync(join(projectDir, typesPath), '// edited by hand\n');

    expect(new DoctorCommand().run(['--project', projectDir])).toBe(1);
    const output = stdout.join('');
    expect(output).toContain(typesPath);
    expect(output).toMatch(/edited by hand/i);
    expect(output).toMatch(/regenerate/);
  });

  it('flags a deleted generated file as missing', () => {
    const projectDir = makeGeneratedProject('deleted');
    const schemasPath = 'src/modules/complaint/schemas/complaint.schemas.ts';
    rmSync(join(projectDir, schemasPath));

    expect(new DoctorCommand().run(['--project', projectDir])).toBe(1);
    expect(stdout.join('')).toContain(`${schemasPath}: missing`);
  });

  it('flags a module whose blueprint file disappeared', () => {
    const projectDir = makeGeneratedProject('no-blueprint');
    rmSync(join(projectDir, '.orangcode', 'blueprints', 'complaint.blueprint.json'));

    expect(new DoctorCommand().run(['--project', projectDir])).toBe(1);
    expect(stdout.join('')).toContain('.orangcode/blueprints/complaint.blueprint.json');
  });

  it('flags a module missing from the src/modules/index.ts markers', () => {
    const projectDir = makeGeneratedProject('unregistered');
    writeFileSync(join(projectDir, 'src', 'modules', 'index.ts'), MODULES_INDEX);

    expect(new DoctorCommand().run(['--project', projectDir])).toBe(1);
    expect(stdout.join('')).toContain('src/modules/index.ts');
  });

  it('flags a prisma region that no longer matches the blueprint', () => {
    const projectDir = makeGeneratedProject('stale-prisma');
    const prismaPath = join(projectDir, 'prisma', 'schema.prisma');
    writeFileSync(
      prismaPath,
      readFileSync(prismaPath, 'utf8').replace('model ComplaintEvent {', 'model Renamed {'),
    );

    expect(new DoctorCommand().run(['--project', projectDir])).toBe(1);
    expect(stdout.join('')).toContain('prisma/schema.prisma');
  });

  it('refuses a directory that is not an OrangCode project', () => {
    const projectDir = join(workDir, 'not-a-project');
    mkdirSync(projectDir, { recursive: true });

    expect(() => new DoctorCommand().run(['--project', projectDir])).toThrow(
      /\.orangcode\/manifest\.json/,
    );
  });
});
