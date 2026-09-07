import { camelCase } from './naming';

/**
 * The `src/modules/index.ts` manifest: two marker-fenced regions the generator owns. A module
 * already present is left byte-for-byte alone, so regeneration is idempotent and hand-added
 * modules (or a different ordering) survive as long as they stay between the markers.
 */

const IMPORTS_START = '/* orangcode:modules:imports:start */';
const IMPORTS_END = '/* orangcode:modules:imports:end */';
const LIST_START = '/* orangcode:modules:list:start */';
const LIST_END = '/* orangcode:modules:list:end */';

function markerIndex(lines: string[], marker: string): number {
  const index = lines.findIndex((line) => line.trim() === marker);

  if (index === -1) {
    throw new Error(
      `src/modules/index.ts has no "${marker}" marker — restore the markers from the template (they fence the region the generator rewrites).`,
    );
  }

  return index;
}

/** Registers a module in the manifest; returns the source unchanged when it is already there. */
export function upsertManifestModule(source: string, moduleName: string): string {
  const lines = source.split('\n');
  const importsStart = markerIndex(lines, IMPORTS_START);
  const importsEnd = markerIndex(lines, IMPORTS_END);
  const listStart = markerIndex(lines, LIST_START);
  const listEnd = markerIndex(lines, LIST_END);

  if (importsEnd < importsStart || listEnd < listStart || listStart < importsEnd) {
    throw new Error(
      'The orangcode markers of src/modules/index.ts are out of order — restore them from the template (imports region first, list region second).',
    );
  }

  const constName = `${camelCase(moduleName)}Module`;
  const importLine = `import { ${constName} } from './${moduleName}/${moduleName}.module';`;
  const listLine = `  ${constName},`;

  insertLine(lines, importsStart, importsEnd, importLine, relativeImportRank(importLine));
  // The import insertion may have shifted every line below it: locate the list region again.
  insertLine(lines, markerIndex(lines, LIST_START), markerIndex(lines, LIST_END), listLine, null);

  return lines.join('\n');
}

/** The `./name/...` path an import sorts by, or null for imports outside the module tree. */
function relativeImportRank(line: string): string | null {
  return /from '(\.\/[^']+)'/.exec(line)?.[1] ?? null;
}

function insertLine(
  lines: string[],
  start: number,
  end: number,
  line: string,
  rank: string | null,
): void {
  const region = lines.slice(start + 1, end);

  if (region.includes(line)) {
    return;
  }

  let offset = region.length;

  if (rank !== null) {
    // Keep relative imports alphabetical without touching anything already in place.
    const after = region.findIndex((existing) => {
      const existingRank = relativeImportRank(existing);

      return existingRank !== null && existingRank > rank;
    });

    if (after !== -1) {
      offset = after;
    }
  }

  lines.splice(start + 1 + offset, 0, line);
}
