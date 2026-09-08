import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GenerateCommand } from './generate.command';
import { RegenerateCommand } from './regenerate.command';

const BLUEPRINT_PATH = fileURLToPath(
  new URL('../../examples/complaint.blueprint.json', import.meta.url),
);

const workDir = mkdtempSync(join(tmpdir(), 'orangcode-cli-regenerate-'));

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

describe('regenerate command', () => {
  it('restores every generated file of every recorded module, byte-identical', () => {
    const projectDir = makeProject('restore');
    expect(new GenerateCommand().run(['module', BLUEPRINT_PATH, '--project', projectDir])).toBe(0);

    const typesPath = join(projectDir, 'src/modules/complaint/types/complaint.types.ts');
    const original = readFileSync(typesPath, 'utf8');
    writeFileSync(typesPath, '// sabotage\n');
    const manifestBefore = readFileSync(join(projectDir, '.orangcode', 'manifest.json'), 'utf8');

    expect(new RegenerateCommand().run(['--project', projectDir])).toBe(0);

    expect(readFileSync(typesPath, 'utf8')).toBe(original);
    expect(readFileSync(join(projectDir, '.orangcode', 'manifest.json'), 'utf8')).toBe(
      manifestBefore,
    );
  });

  it('leaves skeletons alone: a hand-written service survives regeneration', () => {
    const projectDir = makeProject('skeletons');
    expect(new GenerateCommand().run(['module', BLUEPRINT_PATH, '--project', projectDir])).toBe(0);

    const servicePath = join(projectDir, 'src/modules/complaint/services/complaint.service.ts');
    const handWritten = '// hand-written service\n';
    writeFileSync(servicePath, handWritten);

    expect(new RegenerateCommand().run(['--project', projectDir])).toBe(0);
    expect(readFileSync(servicePath, 'utf8')).toBe(handWritten);
  });

  it('says so when the manifest records no module yet', () => {
    const projectDir = makeProject('empty');

    expect(new RegenerateCommand().run(['--project', projectDir])).toBe(0);
    expect(stdout.join('')).toContain('No module recorded');
  });

  it('can target a single recorded module and rejects an unknown one', () => {
    const projectDir = makeProject('targeted');
    expect(new GenerateCommand().run(['module', BLUEPRINT_PATH, '--project', projectDir])).toBe(0);

    expect(new RegenerateCommand().run(['complaint', '--project', projectDir])).toBe(0);
    expect(() => new RegenerateCommand().run(['wallet', '--project', projectDir])).toThrow(
      /wallet.*complaint|complaint.*wallet/s,
    );
  });

  it('refuses a directory that is not an OrangCode project', () => {
    const projectDir = join(workDir, 'not-a-project');
    mkdirSync(projectDir, { recursive: true });

    expect(() => new RegenerateCommand().run(['--project', projectDir])).toThrow(
      /\.orangcode\/manifest\.json/,
    );
  });
});
