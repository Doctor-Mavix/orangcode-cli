import { describe, expect, it } from 'vitest';

import type { Blueprint } from '../blueprint/schema';
import { blueprintSchema } from '../blueprint/schema';
import { emitMongoSchemaFile } from './emit-mongo';
import { emitPrismaBlock } from './emit-prisma';
import { emitRepositoryFile } from './emit-repository';
import { emitSchemasFile } from './emit-schemas';

/** Emitter wiring of the insight 20 §8 extensions (url, by[], index directions). */

function walletBlueprint(overrides: Record<string, unknown> = {}): Blueprint {
  const result = blueprintSchema.safeParse({
    schemaVersion: 1,
    module: {
      name: 'wallet',
      supportedProviders: 'both',
      transactionalGroup: null,
      dependsOn: [],
      softDeleteModels: [],
    },
    enums: { WalletStatus: ['active', 'frozen'] },
    entities: {
      Wallet: {
        fields: {
          actorId: { type: 'string' },
          currency: { type: 'string' },
          website: { type: 'url', nullable: true },
          status: { type: 'enum:WalletStatus', default: 'active' },
        },
        timestamps: true,
        uniques: [['actorId', 'currency']],
        indexes: [['status:asc', 'createdAt:desc']],
      },
    },
    repository: {
      operations: ['create', 'findById', 'list', 'update'],
      extraFinders: [{ name: 'findByOwner', by: ['actorId', 'currency'] }],
      filter: ['status'],
    },
    inputs: {
      openWallet: {
        kind: 'body',
        fields: { website: { type: 'url', optional: true } },
      },
    },
    routes: [{ method: 'post', path: '/', input: 'openWallet', status: 201 }],
    kit: [],
    realtimeEvents: {},
    i18n: false,
    ...overrides,
  });

  if (!result.success) {
    throw new Error(`Test blueprint is invalid: ${result.error.message}`);
  }

  return result.data;
}

describe('index directions', () => {
  it('renders explicit directions in the Prisma index, asc staying implicit', () => {
    const block = emitPrismaBlock(walletBlueprint());

    expect(block).toContain('@@index([status, createdAt(sort: Desc)])');
  });

  it('lets an explicit asc override the keyset convention on createdAt', () => {
    const blueprint = walletBlueprint();
    blueprint.entities['Wallet']!.indexes = [['createdAt:asc'], ['createdAt']];
    const block = emitPrismaBlock(blueprint);

    expect(block).toContain('@@index([createdAt])');
    expect(block).toContain('@@index([createdAt(sort: Desc)])');
  });

  it('renders directions as 1/-1 in the Mongoose index', () => {
    const file = emitMongoSchemaFile(walletBlueprint());

    expect(file).toContain('.index({ status: 1, createdAt: -1 });');
  });
});

describe('multi-field finders', () => {
  it('renders one typed parameter per field of the composite key', () => {
    const file = emitRepositoryFile(walletBlueprint());

    expect(file).toContain('findByOwner(actorId: string, currency: string)');
  });
});

describe('url fields', () => {
  it('validates url inputs with z.url()', () => {
    const file = emitSchemasFile(walletBlueprint());

    expect(file).toContain('z.url()');
  });
});
