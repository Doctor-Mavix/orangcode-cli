/** The whole command contract: the registry needs nothing more to route and document. */
export interface Command {
  readonly name: string;
  readonly summary: string;
  run(args: readonly string[]): number | Promise<number>;
}
