import { readFileSync } from 'node:fs';

import { CliError } from '../errors';

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/**
 * Reads and parses a blueprint file, turning the two classic failure modes (missing file,
 * broken JSON) into actionable messages. Schema validation is the caller's job.
 */
export function loadBlueprintFile(filePath: string): unknown {
  let raw: string;

  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      throw new CliError(
        `Blueprint file not found: "${filePath}". Check the path — it must point to a <module>.blueprint.json file.`,
      );
    }

    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(`Cannot read "${filePath}": ${reason}`);
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    // V8 already reports the offending position and line/column; keep its message verbatim.
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `"${filePath}" is not valid JSON: ${reason}. Fix the syntax — a trailing comma or a missing quote is the usual suspect.`,
    );
  }
}
