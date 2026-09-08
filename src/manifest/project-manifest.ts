import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import { CliError } from '../errors';

const blueprintEntrySchema = z.object({
  module: z.string().min(1),
  blueprint: z.string().min(1),
  generatedFiles: z.record(z.string(), z.string()),
});

const projectManifestSchema = z.object({
  schemaVersion: z.literal(1),
  template: z.string().min(1),
  templateVersion: z.string().min(1),
  generatedBy: z.string().nullable(),
  blueprints: z.array(blueprintEntrySchema),
  supportedProviders: z.array(z.string().min(1)),
});

export type BlueprintEntry = z.infer<typeof blueprintEntrySchema>;
export type ProjectManifest = z.infer<typeof projectManifestSchema>;

export const MANIFEST_RELATIVE_PATH = join('.orangcode', 'manifest.json');

export function readProjectManifest(projectDir: string): ProjectManifest {
  const manifestPath = join(projectDir, MANIFEST_RELATIVE_PATH);

  if (!existsSync(manifestPath)) {
    throw new CliError(
      `No .orangcode/manifest.json found in ${projectDir} — this directory is not an ` +
        `OrangCode project. Run the command from a project created from the template ` +
        `(which ships the manifest), or pass --project <dir>.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `${manifestPath} is not valid JSON (${detail}). Restore it from version control — ` +
        `the CLI never repairs a corrupted manifest on its own.`,
    );
  }

  const result = projectManifestSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new CliError(
      `${manifestPath} does not match the manifest schema:\n${issues}\n` +
        `Restore it from version control, or fix the listed fields by hand.`,
    );
  }

  return result.data;
}

/**
 * Returns a new manifest with the entry added or replaced, blueprints sorted by module name
 * so regeneration order (and the serialized file) never depends on insertion order.
 */
export function upsertBlueprintEntry(
  manifest: ProjectManifest,
  entry: BlueprintEntry,
): ProjectManifest {
  const others = manifest.blueprints.filter((existing) => existing.module !== entry.module);

  return {
    ...manifest,
    blueprints: [...others, entry].sort((a, b) => a.module.localeCompare(b.module)),
  };
}

export function writeProjectManifest(projectDir: string, manifest: ProjectManifest): void {
  const manifestPath = join(projectDir, MANIFEST_RELATIVE_PATH);
  mkdirSync(dirname(manifestPath), { recursive: true });

  // Fixed key order and sorted generatedFiles: the same manifest always serializes to the
  // same bytes, so committed diffs only ever show real changes.
  const serializable = {
    schemaVersion: manifest.schemaVersion,
    template: manifest.template,
    templateVersion: manifest.templateVersion,
    generatedBy: manifest.generatedBy,
    blueprints: manifest.blueprints.map((entry) => ({
      module: entry.module,
      blueprint: entry.blueprint,
      generatedFiles: Object.fromEntries(
        Object.entries(entry.generatedFiles).sort(([a], [b]) => a.localeCompare(b)),
      ),
    })),
    supportedProviders: manifest.supportedProviders,
  };

  writeFileSync(manifestPath, `${JSON.stringify(serializable, null, 2)}\n`);
}
