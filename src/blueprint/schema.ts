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

const enumReferenceSchema = z.custom<EnumReference>(
  (value) => typeof value === 'string' && value.startsWith('enum:'),
  'Expected a scalar type or an enum reference like "enum:ComplaintStatus".',
);

const fieldTypeSchema = z.union([z.enum(SCALAR_FIELD_TYPES), enumReferenceSchema]);

const fieldSchema = z.strictObject({
  type: fieldTypeSchema,
  nullable: z.boolean().optional(),
  unique: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  maxLength: z.number().int().positive().optional(),
  minLength: z.number().int().nonnegative().optional(),
});

const entitySchema = z.strictObject({
  fields: z.record(z.string().min(1), fieldSchema),
  timestamps: z.boolean().optional(),
  softDelete: z.boolean().optional(),
  indexes: z.array(z.array(z.string().min(1))).optional(),
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

const stateMachineSchema = z.strictObject({
  field: z.string().regex(ENTITY_FIELD_REF, 'Expected "Entity.field", e.g. "Complaint.status".'),
  transitions: z.record(z.string().min(1), z.array(z.string().min(1))),
});

export const REPOSITORY_OPERATIONS = ['create', 'findById', 'list', 'update', 'remove'] as const;

const repositorySchema = z.strictObject({
  operations: z.array(z.enum(REPOSITORY_OPERATIONS)),
  extraFinders: z.array(z.strictObject({ name: z.string().min(1), by: z.string().min(1) })),
  filter: z.array(z.string().min(1)),
});

const routeSchema = z.strictObject({
  method: z.enum(['get', 'post', 'patch', 'put', 'delete']),
  path: z.string().min(1),
  access: z.union([z.literal('public'), z.strictObject({ roles: z.array(z.string().min(1)) })]),
  stepUp: z.boolean().optional(),
  input: z.string().min(1).optional(),
  status: z.number().int().optional(),
  pagination: z.boolean().optional(),
});

function enumRefName(type: string): string | null {
  return type.startsWith('enum:') ? type.slice('enum:'.length) : null;
}

const blueprintShape = z.strictObject({
  schemaVersion: z.literal(1, 'Only schemaVersion 1 is supported by this CLI.'),
  module: moduleSchema,
  enums: z.record(
    z.string().regex(PASCAL_CASE, 'Enum names must be PascalCase, e.g. "ComplaintStatus".'),
    z.array(z.string().min(1)).min(1, 'An enum needs at least one value.'),
  ),
  entities: z.record(z.string().min(1), entitySchema),
  stateMachine: stateMachineSchema.optional(),
  repository: repositorySchema,
  routes: z.array(routeSchema),
  kit: z.array(z.string().min(1)),
  realtimeEvents: z.array(z.string().min(1)),
  i18n: z.boolean(),
});

export const blueprintSchema = blueprintShape.superRefine((blueprint, ctx) => {
  const enumNames = Object.keys(blueprint.enums);

  for (const [entityName, entity] of Object.entries(blueprint.entities)) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      const ref = enumRefName(field.type);

      if (ref !== null && !enumNames.includes(ref)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entities', entityName, 'fields', fieldName, 'type'],
          message:
            `Unknown enum "${ref}". Declare it under "enums" or fix the reference` +
            (enumNames.length > 0 ? ` (declared enums: ${enumNames.join(', ')}).` : '.'),
        });
      }
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
});

type BlueprintShape = z.infer<typeof blueprintShape>;

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

  const ref = enumRefName(field.type);

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

  for (const [from, targets] of Object.entries(stateMachine.transitions)) {
    if (!values.includes(from)) {
      ctx.addIssue({
        code: 'custom',
        path: ['stateMachine', 'transitions', from],
        message: `"${from}" is not a value of enum "${ref}" (values: ${values.join(', ')}).`,
      });
    }

    targets.forEach((to, index) => {
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
