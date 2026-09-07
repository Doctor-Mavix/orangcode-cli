/**
 * Marker-delimited regions in `prisma/schema.prisma`. Everything between a module's markers
 * belongs to the generator and is rewritten whole; everything outside is hand-written and
 * never touched — same contract as the `orangcode:` markers of `src/modules/index.ts`.
 */

export function startMarker(moduleName: string): string {
  return `/// orangcode:models:${moduleName}:start`;
}

export function endMarker(moduleName: string): string {
  return `/// orangcode:models:${moduleName}:end`;
}

/**
 * Replaces the module's region with `block` (which must end with a newline), or appends a
 * new marked region at the end of the file when the markers are not there yet.
 */
export function upsertPrismaRegion(source: string, moduleName: string, block: string): string {
  const start = startMarker(moduleName);
  const end = endMarker(moduleName);
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);

  if (startIndex === -1 && endIndex === -1) {
    const separator = source.endsWith('\n') ? '\n' : '\n\n';
    return `${source}${separator}${start}\n\n${block}\n${end}\n`;
  }

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(
      `Broken markers for module "${moduleName}" in prisma/schema.prisma: expected "${start}" before "${end}". Restore the pair, then rerun.`,
    );
  }

  const head = source.slice(0, startIndex + start.length);
  const tail = source.slice(endIndex);

  return `${head}\n\n${block}\n${tail}`;
}
