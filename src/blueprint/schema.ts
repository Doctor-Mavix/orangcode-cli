import { z } from 'zod';

/**
 * The blueprint contract (insight 20 §2) — the single source of truth shared by the three
 * front-ends (visual builder, AI, hand-written JSON). Structural rules live in the Zod
 * shapes; anything that relates two sections lives in the `superRefine` cross-checks so a
 * single run reports every error with its JSON path.
 */

const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;
const ENTITY_FIELD_REF = /^[A-Za-z0-9]+\.[A-Za-z0-9_]+$/;

export const SCALAR_FIELD_TYPES = [
  'string',
  'text',
  'int',
  'bigint',
  'decimal',
  'boolean',
  'date',
  'json',
  'uuid',
  'email',
  'phone',
] as const;

type EnumReference = `enum:${string}`;
type AliasReference = `alias:${string}`;

const enumReferenceSchema = z.custom<EnumReference>(
  (value) => typeof value === 'string' && value.startsWith('enum:'),
  'Expected a scalar type, an enum reference like "enum:ComplaintStatus" or an alias reference like "alias:ActorType".',
);

const aliasReferenceSchema = z.custom<AliasReference>(
  (value) => typeof value === 'string' && value.startsWith('alias:'),
  'Expected a scalar type, an enum reference like "enum:ComplaintStatus" or an alias reference like "alias:ActorType".',
);

const fieldTypeSchema = z.union([
  z.enum(SCALAR_FIELD_TYPES),
  enumReferenceSchema,
  aliasReferenceSchema,
]);

/**
 * Prose carried into generated files. A plain string renders as a one-line comment; an array
 * renders one comment line per item, exactly as authored — wrapping prose is a human
 * judgement call, not something a generator should re-decide on every run.
 */
const docSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

const fieldSchema = z.strictObject({
  type: fieldTypeSchema,
  nullable: z.boolean().optional(),
  unique: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  maxLength: z.number().int().positive().optional(),
  minLength: z.number().int().nonnegative().optional(),
  /** Storage documentation: rendered as a `///` comment on the Prisma column. */
  doc: docSchema.optional(),
  /** Starts a new visual group (blank line) in the Prisma model and the Mongoose schema. */
  gap: z.boolean().optional(),
});

const columnListSchema = z.array(z.array(z.string().min(1)).min(1)).optional();

const entitySchema = z.strictObject({
  fields: z.record(z.string().min(1), fieldSchema),
  // `'createdAt'` = append-only rows: a `createdAt` column but no `updatedAt`.
  timestamps: z.union([z.boolean(), z.literal('createdAt')]).optional(),
  softDelete: z.boolean().optional(),
  indexes: columnListSchema,
  // Composite unique constraints, e.g. [["actorId", "currency"]] — a plain index cannot
  // arbitrate the race a unique does (proj_fintech wallet, insight 20).
  uniques: columnListSchema,
  /**
   * Declares this entity as a collection owned by a parent (a complaint's timeline): SQL gets
   * a cascading foreign key, MongoDB embeds the documents, and the parent's repository reads
   * and writes both in one operation. `as` names the list on the parent.
   */
  ownedBy: z
    .strictObject({
      entity: z.string().min(1),
      as: z.string().min(1),
      doc: docSchema.optional(),
    })
    .optional(),
});

const moduleSchema = z.strictObject({
  name: z
    .string()
    .regex(KEBAB_CASE, 'Module name must be kebab-case, e.g. "complaint" or "wallet-transfer".'),
  supportedProviders: z.enum(['both', 'sql', 'mongo']),
  transactionalGroup: z.string().min(1).nullable(),
  dependsOn: z.array(z.string().min(1)),
  softDeleteModels: z.array(z.string().min(1)),
});

const transitionTargetsSchema = z.array(z.string().min(1));

const stateMachineSchema = z.strictObject({
  field: z.string().regex(ENTITY_FIELD_REF, 'Expected "Entity.field", e.g. "Complaint.status".'),
  transitions: z.record(
    z.string().min(1),
    z.union([
      transitionTargetsSchema,
      z.strictObject({ to: transitionTargetsSchema, doc: docSchema }),
    ]),
  ),
});

export const REPOSITORY_OPERATIONS = ['create', 'findById', 'list', 'update', 'remove'] as const;

const repositorySchema = z.strictObject({
  operations: z.array(z.enum(REPOSITORY_OPERATIONS)),
  extraFinders: z.array(z.strictObject({ name: z.string().min(1), by: z.string().min(1) })),
  filter: z.array(z.string().min(1)),
  /**
   * Root-entity fields the service never provides at creation (a state-machine field starts
   * at its default, an assignment starts empty). They are left out of `New<Entity>`.
   */
  createOmits: z.array(z.string().min(1)).optional(),
  /** The only root-entity fields `update` may touch — the shape of `<Entity>Patch`. */
  patch: z.array(z.string().min(1)).optional(),
});

/**
 * A named request input: one Zod schema in `schemas/<module>.schemas.ts`, referenced from
 * routes by name. `body` and `query` also export an inferred TypeScript type.
 */
const inputFieldSchema = z.strictObject({
  type: z.union([z.enum(SCALAR_FIELD_TYPES), enumReferenceSchema]),
  optional: z.boolean().optional(),
  nullable: z.boolean().optional(),
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().positive().optional(),
  pattern: z.string().min(1).optional(),
  patternMessage: z.string().min(1).optional(),
  /** `.refine(...)` guard for dates that must not be after "now" (incident dates…). */
  notInFuture: z.boolean().optional(),
  /** Normalizes the value with `.toUpperCase()` before any pattern check. */
  uppercase: z.boolean().optional(),
  /** Reuses a pattern exported by a hand-written file instead of inlining a regex. */
  patternFrom: z.strictObject({ file: z.string().min(1), export: z.string().min(1) }).optional(),
});

const inputSchema = z.strictObject({
  kind: z.enum(['body', 'query', 'params']),
  /** A paginated query extends the shared cursor schema instead of starting from scratch. */
  paginated: z.boolean().optional(),
  doc: docSchema.optional(),
  fields: z.record(z.string().min(1), inputFieldSchema),
});

const routeSchema = z.strictObject({
  method: z.enum(['get', 'post', 'patch', 'put', 'delete']),
  path: z.string().min(1),
  // Absent means "authenticated, no specific role" — the template's protected-by-default
  // stance: opening a route to the world must be spelled out, never implied.
  access: z
    .union([z.literal('public'), z.strictObject({ roles: z.array(z.string().min(1)) })])
    .optional(),
  stepUp: z.boolean().optional(),
  input: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  params: z.string().min(1).optional(),
  status: z.number().int().optional(),
  pagination: z.boolean().optional(),
});

function referenceName(type: string, prefix: 'enum:' | 'alias:'): string | null {
  return type.startsWith(prefix) ? type.slice(prefix.length) : null;
}

const blueprintShape = z.strictObject({
  schemaVersion: z.literal(1, 'Only schemaVersion 1 is supported by this CLI.'),
  module: moduleSchema,
  enums: z.record(
    z.string().regex(PASCAL_CASE, 'Enum names must be PascalCase, e.g. "ComplaintStatus".'),
    z.array(z.string().min(1)).min(1, 'An enum needs at least one value.'),
  ),
  /**
   * Documented open string types (`export type ActorType = string;`): the set of values
   * belongs to the generated project, so the type stays open but the intent stays written.
   */
  aliases: z
    .record(
      z.string().regex(PASCAL_CASE, 'Alias names must be PascalCase, e.g. "ActorType".'),
      z.strictObject({ type: z.literal('string'), doc: docSchema.optional() }),
    )
    .optional(),
  entities: z.record(z.string().min(1), entitySchema),
  stateMachine: stateMachineSchema.optional(),
  repository: repositorySchema,
  inputs: z.record(z.string().min(1), inputSchema).optional(),
  routes: z.array(routeSchema),
  kit: z.array(z.string().min(1)),
  /** Event name → payload shape, augmenting the shared `RealtimeEvents` interface. */
  realtimeEvents: z.record(
    z.string().min(1),
    z.record(z.string().min(1), z.enum(['string', 'number', 'boolean'])),
  ),
  i18n: z.boolean(),
});

export const blueprintSchema = blueprintShape.superRefine((blueprint, ctx) => {
  const enumNames = Object.keys(blueprint.enums);
  const aliasNames = Object.keys(blueprint.aliases ?? {});
  const entityNames = Object.keys(blueprint.entities);

  for (const [entityName, entity] of Object.entries(blueprint.entities)) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      const enumRef = referenceName(field.type, 'enum:');

      if (enumRef !== null && !enumNames.includes(enumRef)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entities', entityName, 'fields', fieldName, 'type'],
          message:
            `Unknown enum "${enumRef}". Declare it under "enums" or fix the reference` +
            (enumNames.length > 0 ? ` (declared enums: ${enumNames.join(', ')}).` : '.'),
        });
      }

      const aliasRef = referenceName(field.type, 'alias:');

      if (aliasRef !== null && !aliasNames.includes(aliasRef)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entities', entityName, 'fields', fieldName, 'type'],
          message:
            `Unknown alias "${aliasRef}". Declare it under "aliases" or fix the reference` +
            (aliasNames.length > 0 ? ` (declared aliases: ${aliasNames.join(', ')}).` : '.'),
        });
      }
    }

    if (entity.ownedBy !== undefined && !entityNames.includes(entity.ownedBy.entity)) {
      ctx.addIssue({
        code: 'custom',
        path: ['entities', entityName, 'ownedBy', 'entity'],
        message: `Unknown entity "${entity.ownedBy.entity}". An owned entity must name its parent among "entities".`,
      });
    }

    const knownColumns = new Set([
      'id',
      ...Object.keys(entity.fields),
      ...(entity.timestamps === true ? ['createdAt', 'updatedAt'] : []),
      ...(entity.timestamps === 'createdAt' ? ['createdAt'] : []),
      ...(entity.softDelete === true ? ['deletedAt'] : []),
    ]);

    for (const kind of ['indexes', 'uniques'] as const) {
      (entity[kind] ?? []).forEach((columns, group) => {
        columns.forEach((column, position) => {
          if (!knownColumns.has(column)) {
            ctx.addIssue({
              code: 'custom',
              path: ['entities', entityName, kind, group, position],
              message: `"${column}" is not a field of entity "${entityName}". Declare it under "fields" or fix the ${kind === 'uniques' ? 'unique constraint' : 'index'}.`,
            });
          }
        });
      });
    }
  }

  if (blueprint.stateMachine !== undefined) {
    checkStateMachine(blueprint, blueprint.stateMachine, ctx);
  }

  blueprint.repository.extraFinders.forEach((finder, index) => {
    const exists = Object.values(blueprint.entities).some((entity) => finder.by in entity.fields);

    if (!exists) {
      ctx.addIssue({
        code: 'custom',
        path: ['repository', 'extraFinders', index, 'by'],
        message: `"${finder.by}" is not a field of any declared entity. Add the field under "entities" or fix the finder.`,
      });
    }
  });

  checkRepositoryFieldLists(blueprint, ctx);
  checkInputs(blueprint, ctx);
  checkRoutes(blueprint, ctx);
});

type BlueprintShape = z.infer<typeof blueprintShape>;

/** The entity no other entity owns: the aggregate the repository is written against. */
export function rootEntityName(blueprint: {
  entities: Record<string, { ownedBy?: unknown }>;
}): string | null {
  for (const [name, entity] of Object.entries(blueprint.entities)) {
    if (entity.ownedBy === undefined) {
      return name;
    }
  }

  return null;
}

function checkRepositoryFieldLists(blueprint: BlueprintShape, ctx: z.RefinementCtx): void {
  const rootName = rootEntityName(blueprint);
  const rootFields = rootName === null ? {} : (blueprint.entities[rootName]?.fields ?? {});

  for (const listName of ['createOmits', 'patch'] as const) {
    (blueprint.repository[listName] ?? []).forEach((fieldName, index) => {
      if (!(fieldName in rootFields)) {
        ctx.addIssue({
          code: 'custom',
          path: ['repository', listName, index],
          message: `"${fieldName}" is not a field of the root entity${rootName === null ? '' : ` "${rootName}"`}. Declare it under "entities" or fix "${listName}".`,
        });
      }
    });
  }
}

function checkInputs(blueprint: BlueprintShape, ctx: z.RefinementCtx): void {
  const enumNames = Object.keys(blueprint.enums);

  for (const [inputName, input] of Object.entries(blueprint.inputs ?? {})) {
    if (input.paginated === true && input.kind !== 'query') {
      ctx.addIssue({
        code: 'custom',
        path: ['inputs', inputName, 'paginated'],
        message: `Only a "query" input can be paginated — "${inputName}" is a "${input.kind}".`,
      });
    }

    for (const [fieldName, field] of Object.entries(input.fields)) {
      const enumRef = referenceName(field.type, 'enum:');

      if (enumRef !== null && !enumNames.includes(enumRef)) {
        ctx.addIssue({
          code: 'custom',
          path: ['inputs', inputName, 'fields', fieldName, 'type'],
          message:
            `Unknown enum "${enumRef}". Declare it under "enums" or fix the reference` +
            (enumNames.length > 0 ? ` (declared enums: ${enumNames.join(', ')}).` : '.'),
        });
      }

      if (field.pattern !== undefined && field.patternFrom !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['inputs', inputName, 'fields', fieldName, 'patternFrom'],
          message: 'Use either "pattern" (inline regex) or "patternFrom" (imported), not both.',
        });
      }

      if (field.patternMessage !== undefined && field.pattern === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['inputs', inputName, 'fields', fieldName, 'patternMessage'],
          message: '"patternMessage" documents an inline "pattern" — add the pattern or drop it.',
        });
      }
    }
  }
}

const ROUTE_INPUT_KINDS = { input: 'body', query: 'query', params: 'params' } as const;

function checkRoutes(blueprint: BlueprintShape, ctx: z.RefinementCtx): void {
  const inputs = blueprint.inputs ?? {};

  blueprint.routes.forEach((route, index) => {
    for (const [routeKey, expectedKind] of Object.entries(ROUTE_INPUT_KINDS) as [
      keyof typeof ROUTE_INPUT_KINDS,
      (typeof ROUTE_INPUT_KINDS)[keyof typeof ROUTE_INPUT_KINDS],
    ][]) {
      const name = route[routeKey];

      if (name === undefined) {
        continue;
      }

      const input = inputs[name];

      if (input === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', index, routeKey],
          message: `Unknown input "${name}". Declare it under "inputs" or fix the route.`,
        });
      } else if (input.kind !== expectedKind) {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', index, routeKey],
          message: `Input "${name}" is a "${input.kind}" but "${routeKey}" expects a "${expectedKind}" input.`,
        });
      }
    }
  });
}

/** Accepts both spellings of a transition entry and returns the target list. */
export function transitionTargets(
  entry: string[] | { to: string[]; doc: string | string[] },
): string[] {
  return Array.isArray(entry) ? entry : entry.to;
}

function checkStateMachine(
  blueprint: BlueprintShape,
  stateMachine: NonNullable<BlueprintShape['stateMachine']>,
  ctx: z.RefinementCtx,
): void {
  // The regex on `field` guarantees exactly one dot, so both parts are present.
  const [entityName = '', fieldName = ''] = stateMachine.field.split('.');
  const entity = blueprint.entities[entityName];

  if (entity === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['stateMachine', 'field'],
      message: `Unknown entity "${entityName}". Use "Entity.field" with an entity declared under "entities".`,
    });
    return;
  }

  const field = entity.fields[fieldName];

  if (field === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['stateMachine', 'field'],
      message: `Entity "${entityName}" has no field "${fieldName}". Declare it under "entities.${entityName}.fields".`,
    });
    return;
  }

  const ref = referenceName(field.type, 'enum:');

  if (ref === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['stateMachine', 'field'],
      message: `"${entityName}.${fieldName}" has type "${field.type}" — a state machine needs an "enum:<Name>" field.`,
    });
    return;
  }

  const values = blueprint.enums[ref];

  if (values === undefined) {
    // The unknown enum is already reported on the entity field; repeating it for every
    // transition would drown the real message.
    return;
  }

  for (const [from, entry] of Object.entries(stateMachine.transitions)) {
    if (!values.includes(from)) {
      ctx.addIssue({
        code: 'custom',
        path: ['stateMachine', 'transitions', from],
        message: `"${from}" is not a value of enum "${ref}" (values: ${values.join(', ')}).`,
      });
    }

    transitionTargets(entry).forEach((to, index) => {
      if (!values.includes(to)) {
        ctx.addIssue({
          code: 'custom',
          path: ['stateMachine', 'transitions', from, index],
          message: `"${to}" is not a value of enum "${ref}" (values: ${values.join(', ')}).`,
        });
      }
    });
  }
}

export type Blueprint = z.infer<typeof blueprintSchema>;
export type BlueprintEntity = Blueprint['entities'][string];
export type BlueprintField = BlueprintEntity['fields'][string];
export type BlueprintInput = NonNullable<Blueprint['inputs']>[string];
export type BlueprintInputField = BlueprintInput['fields'][string];
export type BlueprintDoc = string | string[];

/** `['entities', 'Complaint', 'fields', 0]` → `entities.Complaint.fields[0]`. */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return '(root)';
  }

  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === 'number') {
      return `${formatted}[${segment}]`;
    }

    return formatted === '' ? String(segment) : `${formatted}.${String(segment)}`;
  }, '');
}
