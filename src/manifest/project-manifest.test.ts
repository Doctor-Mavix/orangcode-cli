import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CliError } from '../errors';
import {
  readProjectManifest,
  upsertBlueprintEntry,
  writeProjectManifest,
} from './project-manifest';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'orangcode-manifest-'));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

const TEMPLATE_MANIFEST = `${JSON.stringify(
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
)}\n`;

function writeTemplateManifest(): void {
  const dir = join(projectDir, '.orangcode');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), TEMPLATE_MANIFEST);
}

describe('readProjectManifest', () => {
  it('refuses a project without .orangcode/manifest.json, naming the fix', () => {
    expect(() => readProjectManifest(projectDir)).toThrow(CliError);
    expect(() => readProjectManifest(projectDir)).toThrow(/\.orangcode\/manifest\.json/);
  });

  it('reads the manifest the template ships', () => {
    writeTemplateManifest();

    const manifest = readProjectManifest(projectDir);

    expect(manifest.template).toBe('express-typescript');
    expect(manifest.blueprints).toEqual([]);
  });
});

describe('upsertBlueprintEntry + writeProjectManifest', () => {
  it('adds an entry, keeps modules sorted, and round-trips byte-identically', () => {
    writeTemplateManifest();

    const manifest = readProjectManifest(projectDir);
    const withWallet = upsertBlueprintEntry(manifest, {
      module: 'wallet',
      blueprint: '.orangcode/blueprints/wallet.blueprint.json',
      generatedFiles: { 'src/modules/wallet/types/wallet.types.ts': 'abc123' },
    });
    const withBoth = upsertBlueprintEntry(withWallet, {
      module: 'complaint',
      blueprint: '.orangcode/blueprints/complaint.blueprint.json',
      generatedFiles: {},
    });

    expect(withBoth.blueprints.map((entry) => entry.module)).toEqual(['complaint', 'wallet']);

    writeProjectManifest(projectDir, withBoth);
    const first = readFileSync(join(projectDir, '.orangcode', 'manifest.json'), 'utf8');
    writeProjectManifest(projectDir, readProjectManifest(projectDir));
    const second = readFileSync(join(projectDir, '.orangcode', 'manifest.json'), 'utf8');

    expect(second).toBe(first);
    expect(first.endsWith('\n')).toBe(true);
  });

  it('replaces an existing module entry instead of duplicating it', () => {
    writeTemplateManifest();

    const manifest = readProjectManifest(projectDir);
    const once = upsertBlueprintEntry(manifest, {
      module: 'wallet',
      blueprint: '.orangcode/blueprints/wallet.blueprint.json',
      generatedFiles: { a: '1' },
    });
    const twice = upsertBlueprintEntry(once, {
      module: 'wallet',
      blueprint: '.orangcode/blueprints/wallet.blueprint.json',
      generatedFiles: { a: '2' },
    });

    expect(twice.blueprints).toHaveLength(1);
    expect(twice.blueprints[0]?.generatedFiles['a']).toBe('2');
  });
});
