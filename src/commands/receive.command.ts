import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { CliError } from '../errors';
import { readProjectManifest } from '../manifest/project-manifest';
import { writeErr, writeOut } from '../output';
import type { Command } from './command';

const USAGE = 'Usage: orangcode receive <bundle.json> [--project <dir>] [--trusted-key <pem>]';

const bundleSchema = z.object({
  source: z.string().min(1),
  version: z.string().min(1),
  files: z.array(
    z.object({
      path: z.string().min(1),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      content: z.string().min(1),
    }),
  ),
  signature: z.string().min(1),
});

type Bundle = z.infer<typeof bundleSchema>;

interface ReceiveOptions {
  bundlePath: string;
  projectDir: string;
  trustedKeyPath: string | undefined;
}

/**
 * Verifies a delivery from the OrangCode server and journals the outcome under
 * .orangcode/received/. It NEVER writes a delivered file into the project — applying a
 * verified bundle is a separate, future step. No trusted key configured means every
 * delivery is refused: security is the default, not an option.
 */
export class ReceiveCommand implements Command {
  readonly name = 'receive';
  readonly summary = 'Verify a signed delivery bundle and journal it (never applies it).';

  run(args: readonly string[]): number {
    const options = parseOptions(args);
    readProjectManifest(options.projectDir);
    const bundle = loadBundle(options.bundlePath);
    const refusal = findRefusal(options, bundle);

    journal(options.projectDir, bundle, refusal);

    if (refusal !== null) {
      writeErr(`Delivery refused: ${refusal}`);
      writeErr('The refusal was journaled under .orangcode/received/.');
      return 1;
    }

    writeOut(
      `Delivery from "${bundle.source}" (version ${bundle.version}) verified: ` +
        `${bundle.files.length} file(s), signature and hashes OK.`,
    );
    writeOut('Journaled under .orangcode/received/. Nothing was applied to the project.');
    return 0;
  }
}

/** Returns the reason to refuse the bundle, or null when everything verifies. */
function findRefusal(options: ReceiveOptions, bundle: Bundle): string | null {
  const keyPath =
    options.trustedKeyPath ?? join(options.projectDir, '.orangcode', 'trusted.pem');

  if (!existsSync(keyPath)) {
    return (
      `no trusted public key configured (looked at ${keyPath}) — without a key to verify ` +
      `signatures, every delivery is refused.`
    );
  }

  let publicKey;

  try {
    publicKey = createPublicKey(readFileSync(keyPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `the trusted key at ${keyPath} is not a valid public key (${detail}).`;
  }

  // The signature covers the canonical payload: source, version and files, in that order.
  const payload = JSON.stringify({
    source: bundle.source,
    version: bundle.version,
    files: bundle.files,
  });
  let signatureOk: boolean;

  try {
    signatureOk = verify(
      null,
      Buffer.from(payload),
      publicKey,
      Buffer.from(bundle.signature, 'base64'),
    );
  } catch {
    signatureOk = false;
  }

  if (!signatureOk) {
    return 'the signature does not match the bundle content or the trusted key.';
  }

  for (const file of bundle.files) {
    const actual = createHash('sha256')
      .update(Buffer.from(file.content, 'base64'))
      .digest('hex');

    if (actual !== file.sha256) {
      return `sha256 mismatch for "${file.path}" — the file content does not match its declared hash.`;
    }
  }

  return null;
}

function journal(projectDir: string, bundle: Bundle, refusal: string | null): void {
  const dir = join(projectDir, '.orangcode', 'received');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const entry = {
    receivedAt: new Date().toISOString(),
    source: bundle.source,
    version: bundle.version,
    verdict: refusal === null ? 'verified' : 'refused',
    ...(refusal === null ? {} : { reason: refusal }),
    files: bundle.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
  };

  writeFileSync(
    join(dir, `${stamp}-${randomUUID().slice(0, 8)}.json`),
    `${JSON.stringify(entry, null, 2)}\n`,
  );
}

function loadBundle(bundlePath: string): Bundle {
  if (!existsSync(bundlePath)) {
    throw new CliError(`No bundle at "${bundlePath}".\n${USAGE}`);
  }

  let raw: unknown;

  try {
    raw = JSON.parse(readFileSync(bundlePath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(`"${bundlePath}" is not valid JSON (${detail}).`);
  }

  const parsed = bundleSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new CliError(`"${bundlePath}" is not a valid delivery bundle:\n${issues}`);
  }

  return parsed.data;
}

function parseOptions(args: readonly string[]): ReceiveOptions {
  let bundlePath: string | undefined;
  let projectDir = process.cwd();
  let trustedKeyPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--project') {
      const value = args[index + 1];

      if (value === undefined) {
        throw new CliError(`Missing value after --project.\n${USAGE}`);
      }

      projectDir = value;
      index += 1;
    } else if (arg === '--trusted-key') {
      const value = args[index + 1];

      if (value === undefined) {
        throw new CliError(`Missing value after --trusted-key.\n${USAGE}`);
      }

      trustedKeyPath = value;
      index += 1;
    } else if (arg?.startsWith('--') === true) {
      throw new CliError(`Unknown option "${arg}".\n${USAGE}`);
    } else if (bundlePath === undefined && arg !== undefined) {
      bundlePath = arg;
    } else {
      throw new CliError(`Unexpected argument "${arg ?? ''}".\n${USAGE}`);
    }
  }

  if (bundlePath === undefined) {
    throw new CliError(`Missing <bundle.json> argument.\n${USAGE}`);
  }

  return { bundlePath, projectDir, trustedKeyPath };
}
