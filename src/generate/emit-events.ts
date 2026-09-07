import type { Blueprint } from '../blueprint/schema';

/** `types/<module>.events.ts` — the module's augmentation of the shared realtime map. */
export function emitEventsFile(blueprint: Blueprint): string {
  const lines = [
    '/**',
    ' * The realtime vocabulary of this module, declared here rather than in shared/ so the kit',
    ' * stays free of module wording. The module descriptor imports this file for its side effect;',
    ' * the augmentation itself is erased at runtime.',
    ' */',
    "declare module '@shared/realtime/realtime.types' {",
    '  interface RealtimeEvents {',
  ];

  for (const [eventName, payload] of Object.entries(blueprint.realtimeEvents)) {
    lines.push(`    '${eventName}': {`);

    for (const [fieldName, fieldType] of Object.entries(payload)) {
      lines.push(`      ${fieldName}: ${fieldType};`);
    }

    lines.push('    };');
  }

  lines.push('  }', '}', '', 'export {};');

  return `${lines.join('\n')}\n`;
}
