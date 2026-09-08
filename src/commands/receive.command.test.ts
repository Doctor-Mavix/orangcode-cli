import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReceiveCommand } from './receive.command';

let projectDir: string;
let stdout: string[];
let stderr: string[];

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'orangcode-receive-'));
  mkdirSync(join(projectDir, '.orangcode'), { recursive: true });
  writeFileSync(
    join(projectDir, '.orangcode', 'manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        template: 'express-typescript',
        templateVersion: '1.1.0',
        generatedBy: null,
        blueprints: [],
        supportedProviders: ['postgresql'],
      },
      null,
      2,
    )}\n`,
  );
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
  rmSync(projectDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function trustKey(): void {
  writeFileSync(
    join(projectDir, '.orangcode', 'trusted.pem'),
    publicKey.export({ type: 'spki', format: 'pem' }),
  );
}

function makeBundle(mutate?: (bundle: Record<string, unknown>) => void): string {
  const content = Buffer.from("export const delivered = true;\n");
  const files = [
    {
      path: 'src/modules/delivered/delivered.ts',
      sha256: createHash('sha256').update(content).digest('hex'),
      content: content.toString('base64'),
    },
  ];
  const payload = JSON.stringify({ source: 'orangcode-server', version: '1.0.0', files });
  const bundle: Record<string, unknown> = {
    source: 'orangcode-server',
    version: '1.0.0',
    files,
    signature: sign(null, Buffer.from(payload), privateKey).toString('base64'),
  };
  mutate?.(bundle);
  const bundlePath = join(projectDir, 'bundle.json');
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
  return bundlePath;
}

function journalEntries(): { verdict: string; source?: string; reason?: string }[] {
  const dir = join(projectDir, '.orangcode', 'received');

  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir).map(
    (name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as { verdict: string },
  );
}

describe('receive command', () => {
  it('refuses every delivery when no trusted public key is configured, and journals it', () => {
    const bundlePath = makeBundle();

    expect(new ReceiveCommand().run([bundlePath, '--project', projectDir])).toBe(1);

    expect(stderr.join('')).toMatch(/trusted/i);
    const entries = journalEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.verdict).toBe('refused');
  });

  it('verifies a correctly signed bundle, journals it, and applies nothing', () => {
    trustKey();
    const bundlePath = makeBundle();

    expect(new ReceiveCommand().run([bundlePath, '--project', projectDir])).toBe(0);

    const entries = journalEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.verdict).toBe('verified');
    // receive never writes delivered files into the project.
    expect(existsSync(join(projectDir, 'src', 'modules', 'delivered'))).toBe(false);
  });

  it('refuses a bundle whose signature does not match its content', () => {
    trustKey();
    const bundlePath = makeBundle((bundle) => {
      bundle['version'] = '6.6.6';
    });

    expect(new ReceiveCommand().run([bundlePath, '--project', projectDir])).toBe(1);

    expect(stderr.join('')).toMatch(/signature/i);
    expect(journalEntries()[0]?.verdict).toBe('refused');
  });

  it('refuses a bundle whose file hash does not match its content', () => {
    trustKey();
    const bundlePath = makeBundle((bundle) => {
      const files = bundle['files'] as { sha256: string; content: string; path: string }[];
      const file = files[0]!;
      file.sha256 = createHash('sha256').update('something else').digest('hex');
      const payload = JSON.stringify({ source: 'orangcode-server', version: '1.0.0', files });
      bundle['signature'] = sign(null, Buffer.from(payload), privateKey).toString('base64');
    });

    expect(new ReceiveCommand().run([bundlePath, '--project', projectDir])).toBe(1);

    expect(stderr.join('')).toMatch(/sha256/i);
    expect(journalEntries()[0]?.verdict).toBe('refused');
  });

  it('refuses a directory that is not an OrangCode project', () => {
    const outside = mkdtempSync(join(tmpdir(), 'orangcode-receive-outside-'));
    const bundlePath = makeBundle();

    try {
      expect(() => new ReceiveCommand().run([bundlePath, '--project', outside])).toThrow(
        /\.orangcode\/manifest\.json/,
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
