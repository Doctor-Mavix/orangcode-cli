import { describe, expect, it } from 'vitest';

import type { Blueprint } from '../blueprint/schema';
import { blueprintSchema } from '../blueprint/schema';
import { emitControllerFile } from './emit-controller';
import { emitMongoSchemaFile } from './emit-mongo';
import { emitMongoRepositoryFile } from './emit-mongo-repository';
import { emitModuleFile } from './emit-module';
import { emitPrismaBlock } from './emit-prisma';
import { emitPrismaRepositoryFile } from './emit-prisma-repository';
import { emitRepositoryFile } from './emit-repository';
import { emitSchemasFile } from './emit-schemas';
import { domainFiles, moduleFiles } from './index';

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

describe('defaultOrder', () => {
  const blueprint = walletBlueprint({
    repository: {
      operations: ['create', 'findById', 'list', 'update'],
      extraFinders: [],
      filter: ['status'],
      defaultOrder: ['status:desc'],
      patch: ['status'],
    },
  });

  it('prefixes the business sort before the keyset columns in the Prisma list', () => {
    const file = emitPrismaRepositoryFile(blueprint);

    expect(file).toContain(
      "orderBy: [{ status: 'desc' }, { createdAt: query.direction }, { id: query.direction }],",
    );
  });

  it('prefixes the business sort before the keyset columns in the Mongo list', () => {
    const file = emitMongoRepositoryFile(blueprint);

    expect(file).toContain('.sort({ status: -1, createdAt: direction, _id: direction })');
  });

  it('keeps the plain keyset order when no defaultOrder is declared', () => {
    const file = emitPrismaRepositoryFile(walletBlueprint());

    expect(file).toContain('orderBy: [{ createdAt: query.direction }, { id: query.direction }],');
  });
});

describe('single-provider modules', () => {
  const blueprint = walletBlueprint({
    module: {
      name: 'wallet',
      supportedProviders: 'sql',
      transactionalGroup: 'wallet',
      dependsOn: [],
      softDeleteModels: [],
    },
  });

  it('emits only the SQL repository implementation', () => {
    const paths = moduleFiles(blueprint).map((file) => file.path);

    expect(paths).toContain('src/modules/wallet/repositories/sql/wallet.prisma.repository.ts');
    expect(paths.some((path) => path.includes('mongo'))).toBe(false);
  });

  it('emits no Mongoose schema in the domain wave of a SQL-only module', () => {
    const paths = domainFiles(blueprint).map((file) => file.path);

    expect(paths.some((path) => path.includes('mongo'))).toBe(false);
  });

  it('keeps the Mongoose schema in the domain wave of a mongo-only module', () => {
    const mongoOnly = walletBlueprint({
      module: {
        name: 'wallet',
        supportedProviders: 'mongo',
        transactionalGroup: null,
        dependsOn: [],
        softDeleteModels: [],
      },
    });
    const paths = domainFiles(mongoOnly).map((file) => file.path);

    expect(paths).toContain('src/modules/wallet/repositories/mongo/wallet.schema.ts');
  });

  it('wires the module without the provider ternary', () => {
    const file = emitModuleFile(blueprint);

    expect(file).toContain('return new PrismaWalletRepository(sqlClientOf(registration.adapter));');
    expect(file).not.toContain('mongoConnectionOf');
    expect(file).toContain("transactionalGroup: 'wallet',");
  });
});

describe('null defaults', () => {
  it('never renders @default(null) — a nullable column is null by omission', () => {
    const blueprint = walletBlueprint({
      entities: {
        Wallet: {
          fields: {
            actorId: { type: 'string' },
            currency: { type: 'string' },
            website: { type: 'url', nullable: true },
            status: { type: 'enum:WalletStatus', default: 'active' },
            bio: { type: 'string', nullable: true, default: null },
          },
          timestamps: true,
          uniques: [['actorId', 'currency']],
          indexes: [['status:asc', 'createdAt:desc']],
        },
      },
    });
    const block = emitPrismaBlock(blueprint);

    expect(block).toContain('bio');
    expect(block).not.toContain('@default(null)');
  });
});

describe('module wave derivations', () => {
  it('mounts the controller on basePath when one is declared', () => {
    const blueprint = walletBlueprint({
      module: {
        name: 'wallet',
        basePath: '/me/wallets',
        supportedProviders: 'both',
        transactionalGroup: null,
        dependsOn: [],
        softDeleteModels: [],
      },
    });

    expect(emitControllerFile(blueprint)).toContain("@Controller('/me/wallets')");
    expect(emitModuleFile(blueprint)).toContain("mountPath: '/me/wallets',");
  });

  it('derives the mount from the pluralized module name otherwise', () => {
    expect(emitControllerFile(walletBlueprint())).toContain("@Controller('/wallets')");
  });

  it('guards every dependency with its token and renders its doc as the comment', () => {
    const blueprint = walletBlueprint({
      module: {
        name: 'wallet',
        supportedProviders: 'both',
        transactionalGroup: null,
        dependsOn: [{ name: 'notification', doc: 'Transfers notify the counterparty.' }, 'audit'],
        softDeleteModels: [],
      },
    });
    const file = emitModuleFile(blueprint);

    expect(file).toContain(
      "import { NOTIFICATION_SERVICE } from '@shared/notifications/notification.tokens';",
    );
    expect(file).toContain('// Transfers notify the counterparty.');
    expect(file).toContain('if (!container.isRegistered(NOTIFICATION_SERVICE, true)) {');
    expect(file).toContain('if (!container.isRegistered(AUDIT_SERVICE, true)) {');
    expect(file).toContain(
      'The wallet module needs the notification module — add "notification" to MODULES_ENABLED.',
    );
  });

  it('derives the conflict message from the unique column', () => {
    const blueprint = walletBlueprint();
    const wallet = blueprint.entities['Wallet'];
    const actorId = wallet?.fields['actorId'];

    if (actorId !== undefined) {
      actorId.unique = true;
    }

    expect(emitPrismaRepositoryFile(blueprint)).toContain(
      "throw new ConflictError('This actor id is already taken', { cause: error });",
    );
    expect(emitMongoRepositoryFile(blueprint)).toContain(
      "throw new ConflictError('This actor id is already taken', { cause: error });",
    );
  });

  it('uses the hard delete when the root entity has no softDelete', () => {
    const blueprint = walletBlueprint({
      repository: {
        operations: ['create', 'findById', 'remove'],
        extraFinders: [],
        filter: [],
      },
    });
    const prisma = emitPrismaRepositoryFile(blueprint);
    const mongo = emitMongoRepositoryFile(blueprint);

    expect(prisma).toContain('await this.client.wallet.delete({ where: { id } });');
    expect(mongo).toContain('const result = await this.model.deleteOne({ _id: id });');
    expect(mongo).toContain('return result.deletedCount === 1;');
  });
});
