import { describe, expect, it } from 'vitest';

import { blueprintSchema, finderFields, formatIssuePath, parseOrderedColumn } from './schema';

/** Loose mirror of the blueprint shape so tests can corrupt any part of it without casts. */
interface TestBlueprint {
  schemaVersion: number;
  module: Record<string, unknown>;
  enums: Record<string, string[]>;
  aliases?: Record<string, Record<string, unknown>>;
  entities: Record<
    string,
    { fields: Record<string, Record<string, unknown>>; [key: string]: unknown }
  >;
  stateMachine?: {
    field: string;
    transitions: Record<string, string[] | { to: string[]; doc: string }>;
  };
  repository: {
    operations: string[];
    extraFinders: { name: string; by: string | string[] }[];
    filter: string[];
    createOmits?: string[];
    patch?: string[];
    defaultOrder?: string[];
    docs?: Record<string, unknown>;
  };
  controller?: Record<string, unknown>;
  inputs?: Record<
    string,
    { kind: string; fields: Record<string, Record<string, unknown>> } & Record<string, unknown>
  >;
  routes: Record<string, unknown>[];
  kit: string[];
  realtimeEvents: Record<string, Record<string, string>>;
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
      patch: ['status'],
    },
    inputs: {
      createComplaint: {
        kind: 'body',
        fields: {
          reporterEmail: { type: 'email', optional: true, max: 254 },
        },
      },
      listComplaints: {
        kind: 'query',
        fields: {
          status: { type: 'enum:ComplaintStatus', optional: true },
        },
      },
    },
    routes: [
      { method: 'post', path: '/', access: 'public', input: 'createComplaint', status: 201 },
      {
        method: 'get',
        path: '/',
        access: { roles: ['admin'] },
        query: 'listComplaints',
        pagination: true,
      },
    ],
    kit: ['notifications'],
    realtimeEvents: { 'complaint.created': { id: 'string', trackingNumber: 'string' } },
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

  describe('vocabulary extensions (wave 1)', () => {
    it('accepts an alias reference on a field, and rejects an undeclared one', () => {
      const blueprint = baseBlueprint();
      blueprint.aliases = { ActorType: { type: 'string', doc: 'who acted' } };
      blueprint.entities['Complaint']!.fields['actorType'] = { type: 'alias:ActorType' };

      expect(blueprintSchema.safeParse(blueprint).success).toBe(true);

      blueprint.entities['Complaint']!.fields['actorType'] = { type: 'alias:Ghost' };
      expect(failurePaths(blueprint)).toContain('entities.Complaint.fields.actorType.type');
    });

    it('accepts an owned entity and rejects an unknown parent', () => {
      const blueprint = baseBlueprint();
      blueprint.entities['ComplaintEvent'] = {
        ownedBy: { entity: 'Complaint', as: 'timeline' },
        fields: { message: { type: 'string', nullable: true } },
        timestamps: 'createdAt',
      };

      expect(blueprintSchema.safeParse(blueprint).success).toBe(true);

      blueprint.entities['ComplaintEvent'] = {
        ownedBy: { entity: 'Ghost', as: 'timeline' },
        fields: { message: { type: 'string', nullable: true } },
      };
      expect(failurePaths(blueprint)).toContain('entities.ComplaintEvent.ownedBy.entity');
    });

    it('accepts a documented transition entry ({ to, doc })', () => {
      const blueprint = baseBlueprint();
      blueprint.stateMachine!.transitions['in_review'] = {
        to: ['closed'],
        doc: 'a reviewed case can only close',
      };

      expect(blueprintSchema.safeParse(blueprint).success).toBe(true);
    });

    it('rejects a documented transition whose target is not an enum value', () => {
      const blueprint = baseBlueprint();
      blueprint.stateMachine!.transitions['in_review'] = { to: ['archived'], doc: 'nope' };

      expect(failurePaths(blueprint)).toContain('stateMachine.transitions.in_review[0]');
    });

    it('rejects createOmits and patch entries that are not root-entity fields', () => {
      const blueprint = baseBlueprint();
      blueprint.repository.createOmits = ['status', 'ghost'];
      blueprint.repository.patch = ['phantom'];

      const paths = failurePaths(blueprint);
      expect(paths).toContain('repository.createOmits[1]');
      expect(paths).toContain('repository.patch[0]');
      expect(paths).not.toContain('repository.createOmits[0]');
    });

    it('rejects a paginated body input', () => {
      const blueprint = baseBlueprint();
      blueprint.inputs!['createComplaint']!['paginated'] = true;

      expect(failurePaths(blueprint)).toContain('inputs.createComplaint.paginated');
    });

    it('rejects an input field referencing an undeclared enum', () => {
      const blueprint = baseBlueprint();
      blueprint.inputs!['createComplaint']!.fields['status'] = { type: 'enum:Ghost' };

      expect(failurePaths(blueprint)).toContain('inputs.createComplaint.fields.status.type');
    });

    it('rejects patternMessage without a pattern, and pattern combined with patternFrom', () => {
      const blueprint = baseBlueprint();
      blueprint.inputs!['createComplaint']!.fields['phone'] = {
        type: 'string',
        patternMessage: 'must be a phone number',
      };
      blueprint.inputs!['createComplaint']!.fields['tracking'] = {
        type: 'string',
        pattern: '^A$',
        patternFrom: { file: '../utils/tracking-number', export: 'TRACKING_NUMBER_PATTERN' },
      };

      const paths = failurePaths(blueprint);
      expect(paths).toContain('inputs.createComplaint.fields.phone.patternMessage');
      expect(paths).toContain('inputs.createComplaint.fields.tracking.patternFrom');
    });

    it('rejects a route naming an unknown input, and a kind mismatch', () => {
      const blueprint = baseBlueprint();
      blueprint.routes = [
        { method: 'post', path: '/', input: 'ghostInput' },
        { method: 'get', path: '/', query: 'createComplaint' },
      ];

      const paths = failurePaths(blueprint);
      expect(paths).toContain('routes[0].input');
      expect(paths).toContain('routes[1].query');
    });

    it('accepts realtime events with typed payloads only', () => {
      const blueprint = baseBlueprint();
      blueprint.realtimeEvents = { 'complaint.created': { id: 'uuid' } };

      expect(failurePaths(blueprint).some((path) => path.startsWith('realtimeEvents'))).toBe(true);
    });
  });

  describe('expressivity extensions (insight 20 §8)', () => {
    it('accepts the url field type in entities and inputs', () => {
      const blueprint = baseBlueprint();
      blueprint.entities['Complaint']!.fields['website'] = { type: 'url', nullable: true };
      blueprint.inputs!['createComplaint']!.fields['website'] = { type: 'url', optional: true };

      expect(blueprintSchema.safeParse(blueprint).success).toBe(true);
    });

    it('accepts a multi-field finder and rejects one over an unknown field', () => {
      const blueprint = baseBlueprint();
      blueprint.repository.extraFinders = [
        { name: 'findByOwner', by: ['trackingNumber', 'status'] },
      ];

      expect(blueprintSchema.safeParse(blueprint).success).toBe(true);

      blueprint.repository.extraFinders = [
        { name: 'findByOwner', by: ['trackingNumber', 'ghost'] },
      ];

      expect(failurePaths(blueprint)).toContain('repository.extraFinders[0].by[1]');
    });

    it('rejects a single-element multi-field finder (use the string form)', () => {
      const blueprint = baseBlueprint();
      blueprint.repository.extraFinders = [{ name: 'findByOwner', by: ['trackingNumber'] }];

      expect(
        failurePaths(blueprint).some((path) => path.startsWith('repository.extraFinders[0].by')),
      ).toBe(true);
    });

    it('accepts a defaultOrder over root columns and rejects unknown or bare ones', () => {
      const blueprint = baseBlueprint();
      blueprint.repository.defaultOrder = ['status:asc', 'createdAt:desc'];

      expect(blueprintSchema.safeParse(blueprint).success).toBe(true);

      blueprint.repository.defaultOrder = ['ghost:desc'];
      expect(failurePaths(blueprint)).toContain('repository.defaultOrder[0]');

      blueprint.repository.defaultOrder = ['status'];
      expect(failurePaths(blueprint)).toContain('repository.defaultOrder[0]');
    });

    it('accepts a directed index column and still checks the column name', () => {
      const blueprint = baseBlueprint();
      blueprint.entities['Complaint']!['indexes'] = [['status', 'createdAt:desc']];

      expect(blueprintSchema.safeParse(blueprint).success).toBe(true);

      blueprint.entities['Complaint']!['indexes'] = [['ghost:desc']];
      expect(failurePaths(blueprint)).toContain('entities.Complaint.indexes[0][0]');
    });

    it('rejects a direction on a unique column', () => {
      const blueprint = baseBlueprint();
      blueprint.entities['Complaint']!['uniques'] = [['trackingNumber:desc']];

      expect(
        failurePaths(blueprint).some((path) => path.startsWith('entities.Complaint.uniques')),
      ).toBe(true);
    });

    it('accepts a basePath starting with "/" and rejects a relative one', () => {
      const blueprint = baseBlueprint();
      blueprint.module['basePath'] = '/me/addresses';

      expect(blueprintSchema.safeParse(blueprint).success).toBe(true);

      blueprint.module['basePath'] = 'me/addresses';
      expect(failurePaths(blueprint)).toContain('module.basePath');
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

  describe('module-wave vocabulary', () => {
    it('accepts a documented dependency and keeps the bare string form', () => {
      const blueprint = baseBlueprint();
      blueprint.module['dependsOn'] = [
        'audit',
        { name: 'notification', doc: ['Why line one.', 'Why line two.'] },
      ];

      expect(blueprintSchema.safeParse(blueprint).success).toBe(true);

      blueprint.module['dependsOn'] = [{ doc: 'orphan doc' }];
      expect(blueprintSchema.safeParse(blueprint).success).toBe(false);
    });

    it('accepts controller.doc, repository.docs.emptyPatch and route prose slots', () => {
      const blueprint = baseBlueprint();
      blueprint.controller = { doc: 'One controller, two audiences.' };
      blueprint.repository.docs = { emptyPatch: 'MongoDB rejects an empty $set.' };
      blueprint.routes[0] = {
        ...blueprint.routes[0],
        handler: 'submit',
        serviceMethod: 'open',
        doc: 'Prose above the handler.',
        locale: true,
        envelope: { message: 'Saved {trackingNumber}.', statusDoc: 'Why this status.' },
      };

      expect(blueprintSchema.safeParse(blueprint).success).toBe(true);
    });

    it('rejects two routes claiming the same handler name', () => {
      const blueprint = baseBlueprint();
      blueprint.routes = [
        { method: 'post', path: '/', input: 'createComplaint', handler: 'submit' },
        { method: 'get', path: '/', pagination: true, handler: 'submit' },
      ];

      expect(failurePaths(blueprint)).toContain('routes[1].handler');
    });

    it('rejects an upload route without the media kit or with a JSON body', () => {
      const blueprint = baseBlueprint();
      blueprint.routes = [{ method: 'post', path: '/:id/files', upload: { field: 'file' } }];

      expect(failurePaths(blueprint)).toContain('routes[0].upload');

      blueprint.kit = ['media'];
      expect(blueprintSchema.safeParse(blueprint).success).toBe(true);

      blueprint.routes = [
        { method: 'post', path: '/', input: 'createComplaint', upload: { field: 'file' } },
      ];
      expect(failurePaths(blueprint)).toContain('routes[0].input');
    });

    it('rejects a csv export without its kit or combined with pagination', () => {
      const blueprint = baseBlueprint();
      blueprint.routes = [{ method: 'get', path: '/export.csv', csvExport: true }];

      expect(failurePaths(blueprint)).toContain('routes[0].csvExport');

      blueprint.kit = ['csv-export'];
      expect(blueprintSchema.safeParse(blueprint).success).toBe(true);

      blueprint.routes = [
        { method: 'get', path: '/export.csv', csvExport: true, pagination: true },
      ];
      expect(failurePaths(blueprint)).toContain('routes[0].csvExport');
    });

    it('rejects an envelope message quoting a column the root entity does not have', () => {
      const blueprint = baseBlueprint();
      blueprint.routes = [
        {
          method: 'post',
          path: '/',
          input: 'createComplaint',
          envelope: { message: 'Keep {ghostColumn} safe.' },
        },
      ];

      expect(failurePaths(blueprint)).toContain('routes[0].envelope.message');
    });

    it('accepts both returns shorthands and the named-type form', () => {
      const blueprint = baseBlueprint();
      blueprint.routes = [
        { method: 'delete', path: '/:id', returns: 'void' },
        { method: 'get', path: '/:id', returns: 'detail' },
        { method: 'get', path: '/', returns: { type: 'ComplaintView[]', from: 'views' } },
      ];

      expect(blueprintSchema.safeParse(blueprint).success).toBe(true);

      blueprint.routes = [{ method: 'get', path: '/', returns: { type: 'X', from: 'elsewhere' } }];
      expect(blueprintSchema.safeParse(blueprint).success).toBe(false);
    });
  });

  describe('expressivity proof cross-checks (insight 23)', () => {
    it('demands a patch list when the update operation is generated', () => {
      const blueprint = baseBlueprint();
      delete blueprint.repository.patch;

      expect(failurePaths(blueprint)).toContain('repository.patch');
    });

    it('demands a query input on every paginated route', () => {
      const blueprint = baseBlueprint();
      blueprint.routes = [{ method: 'get', path: '/', pagination: true }];

      expect(failurePaths(blueprint)).toContain('routes[0].query');
    });

    it('rejects an input with no fields unless it is a paginated query', () => {
      const blueprint = baseBlueprint();
      blueprint.inputs!['emptyBody'] = { kind: 'body', fields: {} };

      expect(failurePaths(blueprint)).toContain('inputs.emptyBody.fields');
    });

    it('accepts a paginated query with no fields of its own', () => {
      const blueprint = baseBlueprint();
      blueprint.inputs!['listAll'] = { kind: 'query', paginated: true, fields: {} };

      expect(blueprintSchema.safeParse(blueprint).success).toBe(true);
    });

    it('accepts hand-written controllers and polices their naming', () => {
      const blueprint = baseBlueprint();
      blueprint.module['extraControllers'] = ['ComplaintAdminController'];

      expect(blueprintSchema.safeParse(blueprint).success).toBe(true);

      blueprint.module['extraControllers'] = ['complaint-admin'];
      expect(failurePaths(blueprint)).toContain('module.extraControllers[0]');
    });
  });
});

describe('parseOrderedColumn', () => {
  it('splits the direction and leaves bare columns to the emitter convention', () => {
    expect(parseOrderedColumn('createdAt:desc')).toEqual({
      column: 'createdAt',
      direction: 'desc',
    });
    expect(parseOrderedColumn('status:asc')).toEqual({ column: 'status', direction: 'asc' });
    expect(parseOrderedColumn('status')).toEqual({ column: 'status', direction: null });
  });
});

describe('finderFields', () => {
  it('normalizes both spellings of "by" to a list', () => {
    expect(finderFields('trackingNumber')).toEqual(['trackingNumber']);
    expect(finderFields(['actorId', 'currency'])).toEqual(['actorId', 'currency']);
  });
});

describe('formatIssuePath', () => {
  it('renders keys with dots and array indices with brackets', () => {
    expect(formatIssuePath(['entities', 'Complaint', 'fields'])).toBe('entities.Complaint.fields');
    expect(formatIssuePath(['routes', 0, 'method'])).toBe('routes[0].method');
    expect(formatIssuePath([])).toBe('(root)');
  });
});
