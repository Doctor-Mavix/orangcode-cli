import { describe, expect, it } from 'vitest';

import { blueprintSchema, formatIssuePath } from './schema';

/** Loose mirror of the blueprint shape so tests can corrupt any part of it without casts. */
interface TestBlueprint {
  schemaVersion: number;
  module: Record<string, unknown>;
  enums: Record<string, string[]>;
  entities: Record<
    string,
    { fields: Record<string, Record<string, unknown>>; [key: string]: unknown }
  >;
  stateMachine?: { field: string; transitions: Record<string, string[]> };
  repository: {
    operations: string[];
    extraFinders: { name: string; by: string }[];
    filter: string[];
  };
  routes: Record<string, unknown>[];
  kit: string[];
  realtimeEvents: string[];
  i18n: boolean;
}

function baseBlueprint(): TestBlueprint {
  return structuredClone({
    schemaVersion: 1,
    module: {
      name: 'complaint',
      supportedProviders: 'both',
      transactionalGroup: null,
      dependsOn: ['notification'],
      softDeleteModels: ['Complaint'],
    },
    enums: {
      ComplaintStatus: ['pending', 'in_review', 'closed'],
    },
    entities: {
      Complaint: {
        fields: {
          trackingNumber: { type: 'string', unique: true },
          status: { type: 'enum:ComplaintStatus', default: 'pending' },
          reporterEmail: { type: 'email', nullable: true },
        },
        timestamps: true,
        softDelete: true,
        indexes: [['status', 'createdAt']],
      },
    },
    stateMachine: {
      field: 'Complaint.status',
      transitions: {
        pending: ['in_review'],
        in_review: ['closed'],
        closed: [],
      },
    },
    repository: {
      operations: ['create', 'findById', 'list', 'update', 'remove'],
      extraFinders: [{ name: 'findByTrackingNumber', by: 'trackingNumber' }],
      filter: ['status'],
    },
    routes: [
      { method: 'post', path: '/', access: 'public', input: 'createComplaint', status: 201 },
      { method: 'get', path: '/', access: { roles: ['admin'] }, pagination: true },
    ],
    kit: ['notifications'],
    realtimeEvents: ['complaint.created'],
    i18n: true,
  });
}

function failurePaths(input: unknown): string[] {
  const result = blueprintSchema.safeParse(input);

  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.map((issue) => formatIssuePath(issue.path));
}

describe('blueprintSchema', () => {
  it('accepts a complete valid blueprint', () => {
    const result = blueprintSchema.safeParse(baseBlueprint());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.module.name).toBe('complaint');
      expect(result.data.entities['Complaint']?.fields['status']?.type).toBe(
        'enum:ComplaintStatus',
      );
    }
  });

  it('accepts a blueprint without a state machine', () => {
    const blueprint = baseBlueprint();
    delete blueprint.stateMachine;

    expect(blueprintSchema.safeParse(blueprint).success).toBe(true);
  });

  it('rejects an unsupported schemaVersion', () => {
    const blueprint = baseBlueprint();
    blueprint.schemaVersion = 2;

    expect(failurePaths(blueprint)).toContain('schemaVersion');
  });

  it('rejects a module name that is not kebab-case', () => {
    const blueprint = baseBlueprint();
    blueprint.module['name'] = 'ComplaintModule';

    expect(failurePaths(blueprint)).toContain('module.name');
  });

  it('rejects an empty enum value list', () => {
    const blueprint = baseBlueprint();
    blueprint.enums['ComplaintPriority'] = [];

    expect(failurePaths(blueprint).some((path) => path.startsWith('enums'))).toBe(true);
  });

  it('rejects an unknown field type', () => {
    const blueprint = baseBlueprint();
    blueprint.entities['Complaint']!.fields['trackingNumber']!['type'] = 'varchar';

    expect(failurePaths(blueprint)).toContain('entities.Complaint.fields.trackingNumber.type');
  });

  it('reports every error at once, not only the first', () => {
    const blueprint = baseBlueprint();
    blueprint.schemaVersion = 2;
    blueprint.module['name'] = 'Bad Name';

    const result = blueprintSchema.safeParse(blueprint);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThanOrEqual(2);
    }
  });

  describe('cross-validations', () => {
    it('rejects an enum reference to an undeclared enum', () => {
      const blueprint = baseBlueprint();
      blueprint.entities['Complaint']!.fields['status']!['type'] = 'enum:UnknownStatus';

      expect(failurePaths(blueprint)).toContain('entities.Complaint.fields.status.type');
    });

    it('rejects a stateMachine.field pointing at an unknown entity', () => {
      const blueprint = baseBlueprint();
      blueprint.stateMachine!.field = 'Ticket.status';

      expect(failurePaths(blueprint)).toContain('stateMachine.field');
    });

    it('rejects a stateMachine.field pointing at an unknown field', () => {
      const blueprint = baseBlueprint();
      blueprint.stateMachine!.field = 'Complaint.state';

      expect(failurePaths(blueprint)).toContain('stateMachine.field');
    });

    it('rejects a stateMachine.field pointing at a non-enum field', () => {
      const blueprint = baseBlueprint();
      blueprint.stateMachine!.field = 'Complaint.trackingNumber';

      expect(failurePaths(blueprint)).toContain('stateMachine.field');
    });

    it('rejects a transition source that is not an enum value', () => {
      const blueprint = baseBlueprint();
      blueprint.stateMachine!.transitions['archived'] = [];

      expect(failurePaths(blueprint)).toContain('stateMachine.transitions.archived');
    });

    it('rejects a transition target that is not an enum value', () => {
      const blueprint = baseBlueprint();
      blueprint.stateMachine!.transitions['pending'] = ['in_review', 'archived'];

      expect(failurePaths(blueprint)).toContain('stateMachine.transitions.pending[1]');
    });

    it('reports the bad source and the bad target together', () => {
      const blueprint = baseBlueprint();
      blueprint.stateMachine!.transitions['archived'] = ['nowhere'];

      const paths = failurePaths(blueprint);
      expect(paths).toContain('stateMachine.transitions.archived');
      expect(paths).toContain('stateMachine.transitions.archived[0]');
    });

    it('rejects an extraFinder whose "by" is not an entity field', () => {
      const blueprint = baseBlueprint();
      blueprint.repository.extraFinders = [{ name: 'findByCode', by: 'code' }];

      expect(failurePaths(blueprint)).toContain('repository.extraFinders[0].by');
    });

    it('accepts a composite unique over declared fields', () => {
      const blueprint = baseBlueprint();
      blueprint.entities['Complaint']!['uniques'] = [['trackingNumber', 'status']];

      expect(blueprintSchema.safeParse(blueprint).success).toBe(true);
    });

    it('rejects an index or unique on a column no entity declares', () => {
      const blueprint = baseBlueprint();
      blueprint.entities['Complaint']!['uniques'] = [['actorId', 'currency']];
      blueprint.entities['Complaint']!['indexes'] = [['ghost']];

      const paths = failurePaths(blueprint);
      expect(paths).toContain('entities.Complaint.uniques[0][0]');
      expect(paths).toContain('entities.Complaint.uniques[0][1]');
      expect(paths).toContain('entities.Complaint.indexes[0][0]');
    });

    it('accepts an index on deletedAt when the entity is soft-deleted', () => {
      const blueprint = baseBlueprint();
      blueprint.entities['Complaint']!['indexes'] = [['status', 'deletedAt']];

      expect(blueprintSchema.safeParse(blueprint).success).toBe(true);
    });

    it('rejects a timestamps column in an index when timestamps are off', () => {
      const blueprint = baseBlueprint();
      blueprint.entities['Complaint']!['timestamps'] = false;

      // The base blueprint indexes createdAt, which only exists through timestamps.
      expect(failurePaths(blueprint)).toContain('entities.Complaint.indexes[0][1]');
    });
  });

  it('treats a route without access as authenticated, and keeps it valid', () => {
    const blueprint = baseBlueprint();
    blueprint.routes = [{ method: 'get', path: '/:id' }];

    const result = blueprintSchema.safeParse(blueprint);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.routes[0]?.access).toBeUndefined();
    }
  });
});

describe('formatIssuePath', () => {
  it('renders keys with dots and array indices with brackets', () => {
    expect(formatIssuePath(['entities', 'Complaint', 'fields'])).toBe('entities.Complaint.fields');
    expect(formatIssuePath(['routes', 0, 'method'])).toBe('routes[0].method');
    expect(formatIssuePath([])).toBe('(root)');
  });
});
