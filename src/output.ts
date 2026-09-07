/** Single write seam for the whole CLI: tests capture output by spying on these two streams. */

export function writeOut(line: string): void {
  process.stdout.write(`${line}\n`);
}

export function writeErr(line: string): void {
  process.stderr.write(`${line}\n`);
}
