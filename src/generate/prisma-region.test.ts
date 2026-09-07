import { describe, expect, it } from 'vitest';

import { endMarker, startMarker, upsertPrismaRegion } from './prisma-region';

const BASE = ['datasource db {', '  provider = "postgresql"', '}', ''].join('\n');
const BLOCK_A = 'model Complaint {\n  id String @id\n}\n';
const BLOCK_B = 'model Complaint {\n  id     String @id\n  status String\n}\n';

describe('upsertPrismaRegion', () => {
  it('appends a new marked region when the markers are absent', () => {
    const result = upsertPrismaRegion(BASE, 'complaint', BLOCK_A);

    expect(result).toBe(
      `${BASE}\n${startMarker('complaint')}\n\n${BLOCK_A}\n${endMarker('complaint')}\n`,
    );
  });

  it('replaces only the module region and leaves the rest untouched', () => {
    const withRegion = upsertPrismaRegion(BASE, 'complaint', BLOCK_A);
    const updated = upsertPrismaRegion(withRegion, 'complaint', BLOCK_B);

    expect(updated).toContain('status String');
    expect(updated).not.toContain('id String @id\n}');
    expect(updated.startsWith(BASE)).toBe(true);
    expect(updated.split(startMarker('complaint'))).toHaveLength(2);
  });

  it('is idempotent: rewriting the same block returns the identical file', () => {
    const once = upsertPrismaRegion(BASE, 'complaint', BLOCK_A);
    const twice = upsertPrismaRegion(once, 'complaint', BLOCK_A);

    expect(twice).toBe(once);
  });

  it('keeps regions of different modules independent', () => {
    const withComplaint = upsertPrismaRegion(BASE, 'complaint', BLOCK_A);
    const withBoth = upsertPrismaRegion(
      withComplaint,
      'wallet',
      'model Wallet {\n  id String @id\n}\n',
    );
    const updated = upsertPrismaRegion(withBoth, 'complaint', BLOCK_B);

    expect(updated).toContain('model Wallet');
    expect(updated).toContain('status String');
  });

  it('fails loudly on a half-deleted marker pair', () => {
    const broken = upsertPrismaRegion(BASE, 'complaint', BLOCK_A).replace(
      `${endMarker('complaint')}\n`,
      '',
    );

    expect(() => upsertPrismaRegion(broken, 'complaint', BLOCK_B)).toThrow(/Broken markers/);
  });
});
