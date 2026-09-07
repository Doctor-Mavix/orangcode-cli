/**
 * A user-facing failure: the CLI prints the message alone (no stack trace) and exits 1.
 * Every message must tell the reader what happened AND what to do about it.
 */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}
