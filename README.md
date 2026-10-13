# @orangcode/cli

Command-line companion of the [OrangCode Express + TypeScript template](https://github.com/GITHUB_USER/orangcode-express-ts).
A module is described once, in a `<module>.blueprint.json` file; the CLI turns it into the
mechanical part of the module — types, Zod schemas, SQL (Prisma) and MongoDB (Mongoose)
repositories, controller, module wiring — and keeps the project honest afterwards.

Two properties are the point of the tool:

- **Determinism.** Regenerating a module produces the same bytes. A golden test regenerates the
  template's showcase module and compares it byte for byte with the hand-groomed original.
- **Generated vs written.** Business logic lives in hand-written files (`services/`, tests, i18n)
  that the generator creates once and never overwrites. Every generated file is recorded with its
  sha256 in `.orangcode/manifest.json`, so a hand edit to a generated file is detected.

## Install

Requires Node >= 22 and pnpm.

```bash
pnpm install
pnpm build        # emits dist/cli.js (the `orangcode` binary)
```

## Commands

| Command                                                         | What it does                                                                                                                                                                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate <blueprint>`                                          | Checks a blueprint against the embedded Zod schema and reports **every** error at once, each with its JSON path. Cross-references are verified too (enums, state machine, finders)                                           |
| `generate module <blueprint> [--project <dir>] [--only domain]` | Generates the module into a project created from the template. Refuses a directory that is not such a project **before** writing anything                                                                                    |
| `regenerate [module] [--project <dir>]`                         | Replays generation from the manifest. On the template, a full regenerate leaves `git status` empty                                                                                                                           |
| `doctor [--project <dir>]`                                      | Compares, for each generated file, the bytes on disk, the hash in the manifest and a fresh emission: reports `missing`, `edited by hand` or `stale`. Exit code 1 on any problem                                              |
| `list [--project <dir>]`                                        | Lists the core commands and the project's custom commands (`.orangcode/commands/`)                                                                                                                                           |
| `receive <bundle> [--project <dir>] [--trusted-key <pem>]`      | Verifies a code delivery from the OrangCode server: Ed25519 signature, then the sha256 of every file. Without a trusted public key everything is refused. Every delivery is journaled; nothing is ever applied automatically |
| `help` · `version`                                              |                                                                                                                                                                                                                              |

```bash
node dist/cli.js validate examples/complaint.blueprint.json
node dist/cli.js generate module examples/complaint.blueprint.json --project ../orangcode-express-ts
node dist/cli.js doctor --project ../orangcode-express-ts
```

During development: `pnpm dev <command> ...`.

### Custom commands

A project extends the CLI with `.orangcode/commands/<name>/command.json`
(`name`, `description`, `run: "./run.mjs"` or `"shell: ..."`). Safety rules: nothing runs
without an explicit yes (`--yes` or a TTY confirmation), the script must live inside its own
command directory (no `../../`), and the name must match its directory.

## Testing

```bash
pnpm test
```

The golden test needs a checkout of the template. It looks for it next to this repository
(`../nodejs_express_typescript/`) or at `ORANGCODE_TEMPLATE_DIR`; without one, that suite is
skipped and the others still run:

```bash
git clone https://github.com/GITHUB_USER/orangcode-express-ts ../template
ORANGCODE_TEMPLATE_DIR=../template pnpm test
```

Some comments refer to "insight NN": these are the internal design notes (in French) written
during the project.

## Scripts

`pnpm typecheck` · `pnpm lint` · `pnpm format` · `pnpm test` · `pnpm build`

---

## The OrangCode TypeScript family

- [orangcode-express-ts](https://github.com/GITHUB_USER/orangcode-express-ts) — the template: Express 5 + strict TypeScript, Postgres (Prisma) or MongoDB (Mongoose)
- **orangcode-cli** (this repository) — the generator: blueprint → module, byte-identical regeneration
- [mobile-money-ledger-api](https://github.com/GITHUB_USER/mobile-money-ledger-api) — validation project: wallets, transfers, double-entry ledger (Postgres)
- [social-feed-api](https://github.com/GITHUB_USER/social-feed-api) — validation project: follow graph and home timeline (MongoDB)
- [ecommerce-orders-api](https://github.com/GITHUB_USER/ecommerce-orders-api) — validation project: catalogue, cart, orders (Postgres)

## How I built this with Claude Code

This repository is part of the TypeScript redesign of [OrangCode](https://orangcode.com), the
low-code platform I co-founded. I designed the architecture and directed the work; Claude Code
(Opus and Fable models) wrote most of the code, step by step, under these rules:

- **Spec first.** Each step started from a written plan with acceptance criteria. I reviewed and
  approved the plan before any code was written.
- **Tests first, and seen red.** A new test had to fail before the fix that makes it pass.
  Important guarantees were also checked by _sabotage_: remove the protection on purpose and
  confirm that a test fails.
- **One session log for several models.** A numbered set of design notes and a session log let a
  new session, or a different model, continue the work without losing context.
- **Human review of every diff.** I read each change and asked for corrections before it was
  committed.
- **Quality gates on every step:** strict TypeScript, type-aware ESLint, Prettier, and the full
  test suite.
