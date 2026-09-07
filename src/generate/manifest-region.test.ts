import { describe, expect, it } from 'vitest';

import { upsertManifestModule } from './manifest-region';

const MANIFEST = [
  "import type { AppModule } from '@core/module';",
  '/* orangcode:modules:imports:start */',
  "import { notificationModule } from '@shared/notifications/notification.module';",
  "import { authModule } from './auth/auth.module';",
  "import { healthModule } from './health/health.module';",
  '/* orangcode:modules:imports:end */',
  '',
  'export const APP_MODULES: readonly AppModule[] = [',
  '  /* orangcode:modules:list:start */',
  '  healthModule,',
  '  notificationModule,',
  '  authModule,',
  '  /* orangcode:modules:list:end */',
  '];',
  '',
].join('\n');

describe('upsertManifestModule', () => {
  it('inserts the import alphabetically among the relative imports and appends to the list', () => {
    const updated = upsertManifestModule(MANIFEST, 'complaint');
    const lines = updated.split('\n');

    expect(lines.indexOf("import { complaintModule } from './complaint/complaint.module';")).toBe(
      1 + lines.indexOf("import { authModule } from './auth/auth.module';"),
    );
    expect(lines.indexOf('  complaintModule,')).toBe(1 + lines.indexOf('  authModule,'));
    expect(lines.indexOf('  complaintModule,')).toBe(
      lines.findIndex((line) => line.trim() === '/* orangcode:modules:list:end */') - 1,
    );
  });

  it('appends after every relative import when the module sorts last', () => {
    const updated = upsertManifestModule(MANIFEST, 'wallet');

    expect(updated).toContain(
      [
        "import { healthModule } from './health/health.module';",
        "import { walletModule } from './wallet/wallet.module';",
        '/* orangcode:modules:imports:end */',
      ].join('\n'),
    );
  });

  it('is idempotent: registering a present module changes nothing', () => {
    const once = upsertManifestModule(MANIFEST, 'complaint');

    expect(upsertManifestModule(once, 'complaint')).toBe(once);
    expect(upsertManifestModule(MANIFEST, 'health')).toBe(MANIFEST);
  });

  it('never reorders what is already between the markers', () => {
    const updated = upsertManifestModule(MANIFEST, 'complaint');

    expect(updated).toContain(
      ['  healthModule,', '  notificationModule,', '  authModule,'].join('\n'),
    );
  });

  it('derives the camelCase constant from a kebab-case module name', () => {
    const updated = upsertManifestModule(MANIFEST, 'wallet-transfer');

    expect(updated).toContain(
      "import { walletTransferModule } from './wallet-transfer/wallet-transfer.module';",
    );
    expect(updated).toContain('  walletTransferModule,');
  });

  it('reports a missing or misordered marker with a fix', () => {
    expect(() => upsertManifestModule('export const APP_MODULES = [];', 'complaint')).toThrow(
      /orangcode:modules:imports:start.*restore the markers/,
    );

    const swapped = MANIFEST.replace('imports:start', 'X').replace('imports:end', 'imports:start');
    expect(() => upsertManifestModule(swapped, 'complaint')).toThrow(/restore/);
  });
});
