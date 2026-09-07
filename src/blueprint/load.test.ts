import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { CliError } from '../errors';
import { loadBlueprintFile } from './load';

const workDir = mkdtempSync(join(tmpdir(), 'orangcode-cli-load-'));

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('loadBlueprintFile', () => {
  it('returns the parsed JSON of an existing file', () => {
    const filePath = join(workDir, 'ok.blueprint.json');
    writeFileSync(filePath, '{"schemaVersion": 1}');

    expect(loadBlueprintFile(filePath)).toEqual({ schemaVersion: 1 });
  });

  it('fails with a readable message when the file does not exist', () => {
    const filePath = join(workDir, 'missing.blueprint.json');

    expect(() => loadBlueprintFile(filePath)).toThrow(CliError);
    expect(() => loadBlueprintFile(filePath)).toThrow(/not found/);
    expect(() => loadBlueprintFile(filePath)).toThrow(new RegExp(filePath));
  });

  it('fails with the parser position when the JSON is broken', () => {
    const filePath = join(workDir, 'broken.blueprint.json');
    writeFileSync(filePath, '{"schemaVersion": 1,}');

    expect(() => loadBlueprintFile(filePath)).toThrow(CliError);
    // V8 reports where it choked; the wrapper must keep that detail.
    expect(() => loadBlueprintFile(filePath)).toThrow(/not valid JSON/);
    expect(() => loadBlueprintFile(filePath)).toThrow(/position|line/);
  });
});
