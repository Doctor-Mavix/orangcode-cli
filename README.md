# @orangcode/cli

Command-line companion of the OrangCode TypeScript template (`nodejs_express_typescript/`,
v1.1.0). It validates module blueprints today; module generation is the next milestone.
Design and rationale: `../insights/20_CONCEPTION_ORDRE_10_CLI_ET_BLUEPRINT.md`.

## Install

Requires Node >= 22 and pnpm.

```bash
pnpm install
pnpm build        # emits dist/cli.js (the `orangcode` binary)
```

## Commands

```bash
node dist/cli.js help                                     # list commands
node dist/cli.js version                                  # print the CLI version
node dist/cli.js validate examples/complaint.blueprint.json
```

During development: `pnpm dev validate <blueprint>`.

`validate` checks a `<module>.blueprint.json` file against the embedded Zod schema and
reports **every** error at once, each with its JSON path (for example
`entities.Complaint.fields.status.type`). Cross-references are verified too: `enum:<Name>`
must point at a declared enum, the state machine must target an existing enum field and only
use its values, and every extra finder must name a real entity field.

## Generated vs written

A blueprint is the single source of truth for the _mechanical_ part of a module (types,
schemas, repositories, controller, manifest). Business logic stays in hand-written files that
the generator will never overwrite. The exact file-by-file split is defined in insight 20 §3.

## Scripts

`pnpm typecheck` · `pnpm lint` · `pnpm format` · `pnpm test` · `pnpm build`
