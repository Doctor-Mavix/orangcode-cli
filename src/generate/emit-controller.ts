import type {
  Blueprint,
  BlueprintInput,
  BlueprintInputField,
  BlueprintRoute,
} from '../blueprint/schema';
import type { EntityView } from './model';
import { PRINT_WIDTH, formatImport, jsdoc, ownedChildren, rootEntity } from './model';
import { camelCase, kebabPlural, pascalCase } from './naming';

/**
 * `controllers/<module>.controller.ts` — one handler per route, each delegating to the
 * hand-written service. Every naming and prose decision comes from the blueprint; the
 * feature boilerplate (upload, CSV export, locale) is identical for every module.
 */
export function emitControllerFile(blueprint: Blueprint): string {
  const root = rootEntity(blueprint);
  const detailType =
    ownedChildren(blueprint, root.name).length > 0 ? `${root.name}Detail` : root.name;
  const views = blueprint.routes.map((route) => routeView(blueprint, route, root, detailType));

  const handlers = views.map((view) => emitHandler(blueprint, view, root));
  const body = handlers.join('\n\n');

  const sections: string[] = [importSection(blueprint, views, root, detailType)];

  if (views.some((view) => view.paramsType === 'IdParams')) {
    sections.push(['interface IdParams {', '  id: string;', '}'].join('\n'));
  }

  const uploadField = views.find((view) => view.route.upload !== undefined)?.route.upload?.field;

  if (uploadField !== undefined) {
    sections.push(`const ATTACHMENT_FIELD = '${uploadField}';`);
  }

  const classDoc = blueprint.controller?.doc;
  const mount = blueprint.module.basePath ?? `/${kebabPlural(blueprint.module.name)}`;
  const className = `${root.name}Controller`;

  sections.push(
    [
      ...(classDoc === undefined ? [] : [jsdoc(classDoc)]),
      `@Controller('${mount}')`,
      `export class ${className} {`,
      constructorSection(views, root),
      '',
      body,
      '}',
    ].join('\n'),
  );

  return `${sections.join('\n\n')}\n`;
}

/** How a handler hands its result back to the HTTP layer. */
type ReturnShape =
  | { kind: 'csv' }
  | { kind: 'upload' }
  | { kind: 'page' }
  | { kind: 'envelope'; message: string | undefined; status: number | undefined }
  | { kind: 'plain'; type: string }
  | { kind: 'void' };

interface RouteView {
  route: BlueprintRoute;
  handler: string;
  serviceMethod: string;
  bodyType: string | null;
  queryType: string | null;
  /** `'IdParams'`, an inline object type, or null when the route takes no path parameter. */
  paramsType: string | null;
  paramsFields: string[];
  shape: ReturnShape;
  returnType: string;
}

function inputOf(blueprint: Blueprint, name: string | undefined): BlueprintInput | undefined {
  return name === undefined ? undefined : blueprint.inputs?.[name];
}

/** The TS type a validated input field carries into the handler (`z.coerce.date()` → `Date`). */
function inputTsType(field: BlueprintInputField): string {
  if (field.type.startsWith('enum:')) {
    return field.type.slice('enum:'.length);
  }

  switch (field.type) {
    case 'int':
    case 'bigint':
    case 'decimal':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'Date';
    case 'json':
      return 'unknown';
    default:
      return 'string';
  }
}

/** `post /` → `create`, `get /export.csv` → `exportCsv`; an explicit `handler` always wins. */
export function routeHandlerName(route: BlueprintRoute): string {
  if (route.handler !== undefined) {
    return route.handler;
  }

  const segments = route.path.split('/').filter((part) => part !== '' && !part.startsWith(':'));

  if (segments.length > 0) {
    return camelCase(segments.join('-'));
  }

  if (route.method === 'get') {
    return route.path.includes(':') ? 'detail' : 'list';
  }

  return { post: 'create', patch: 'update', put: 'replace', delete: 'remove' }[route.method];
}

/** The status the registry would answer with anyway — spelling it out again would be noise. */
function defaultStatus(route: BlueprintRoute): number {
  return route.method === 'post' ? 201 : 200;
}

function returnShape(route: BlueprintRoute, detailType: string): ReturnShape {
  if (route.csvExport === true) {
    return { kind: 'csv' };
  }

  if (route.upload !== undefined) {
    return { kind: 'upload' };
  }

  if (route.pagination === true) {
    return { kind: 'page' };
  }

  const explicit = route.status !== undefined && route.status !== defaultStatus(route);
  const status = explicit ? route.status : undefined;

  if (route.envelope !== undefined || status !== undefined) {
    return { kind: 'envelope', message: route.envelope?.message, status };
  }

  if (route.returns === 'void' || (route.returns === undefined && route.method === 'delete')) {
    return { kind: 'void' };
  }

  if (route.returns !== undefined && route.returns !== 'detail') {
    return { kind: 'plain', type: route.returns.type };
  }

  return { kind: 'plain', type: detailType };
}

function routeView(
  blueprint: Blueprint,
  route: BlueprintRoute,
  root: EntityView,
  detailType: string,
): RouteView {
  const bodyInput = inputOf(blueprint, route.input);
  const queryInput = inputOf(blueprint, route.query);
  const paramsInput = inputOf(blueprint, route.params);
  const handler = routeHandlerName(route);
  const shape = returnShape(route, detailType);

  let paramsType: string | null = null;
  let paramsFields: string[] = [];

  if (paramsInput !== undefined) {
    const entries = Object.entries(paramsInput.fields);
    paramsFields = entries.map(([name]) => name);
    paramsType =
      entries.length === 1 && entries[0]?.[0] === 'id'
        ? 'IdParams'
        : `{ ${entries.map(([name, field]) => `${name}: ${inputTsType(field)}`).join('; ')} }`;
  }

  return {
    route,
    handler,
    serviceMethod: route.serviceMethod ?? handler,
    bodyType: bodyInput === undefined ? null : `${pascalCase(route.input ?? '')}Input`,
    queryType: queryInput === undefined ? null : `${pascalCase(route.query ?? '')}Query`,
    paramsType,
    paramsFields,
    shape,
    returnType: returnTypeOf(shape, root, detailType),
  };
}

function returnTypeOf(shape: ReturnShape, root: EntityView, detailType: string): string {
  switch (shape.kind) {
    case 'csv':
    case 'void':
      return 'Promise<void>';
    case 'upload':
      return 'Promise<Media>';
    case 'page':
      return `Promise<ApiPayload<${root.name}[]>>`;
    case 'envelope':
      return `Promise<ApiPayload<${detailType}>>`;
    case 'plain':
      return `Promise<${shape.type}>`;
  }
}

function typedRequestOf(view: RouteView): string {
  const generics = [view.bodyType ?? 'unknown', view.queryType ?? 'unknown', view.paramsType];
  const kept: string[] = [];

  for (const generic of generics) {
    if (generic !== null) {
      kept.push(generic);
    } else {
      break;
    }
  }

  while (kept.length > 0 && kept.at(-1) === 'unknown') {
    kept.pop();
  }

  return kept.length === 0 ? 'TypedRequest' : `TypedRequest<${kept.join(', ')}>`;
}

const LOCALE_ARGUMENT = "this.i18n.resolve(req.get('accept-language'))";

const LOCALE_COMMENT = [
  '    // Reading Accept-Language is an HTTP concern, so the service is told the locale rather',
  '    // than handed the request.',
];

const UPLOAD_DOC = [
  'Multipart, so `@Validate` cannot see the body: multer parses it and the file itself is',
  'validated by its magic bytes in the kit rather than by a trusted Content-Type header.',
];

function csvDoc(route: BlueprintRoute): string[] {
  const basename = route.path.split('/').filter(Boolean).at(-1) ?? route.path;

  return [
    'Declared before `/:id` on purpose: Express matches in registration order, and a parameter',
    `route registered first would swallow "${basename}" as an id.`,
    '',
    'The handler writes to the response itself instead of returning a value; the registry sees',
    'the headers are already sent and leaves the stream alone.',
  ];
}

function handlerDoc(view: RouteView): string[] {
  const doc = view.route.doc;

  if (doc !== undefined) {
    return [jsdoc(doc, '  ')];
  }

  if (view.shape.kind === 'upload') {
    return [jsdoc(UPLOAD_DOC, '  ')];
  }

  if (view.shape.kind === 'csv') {
    return [jsdoc(csvDoc(view.route), '  ')];
  }

  return [];
}

function decoratorLines(view: RouteView): string[] {
  const { route } = view;
  const lines = [`  @${pascalCase(route.method)}('${route.path}')`];

  if (route.access === 'public') {
    lines.push('  @Public()');
  } else if (route.access !== undefined) {
    lines.push(`  @Roles(${route.access.roles.map((role) => `'${role}'`).join(', ')})`);
  }

  if (route.stepUp === true) {
    lines.push('  @StepUp()');
  }

  if (route.upload !== undefined) {
    lines.push("  @Consumes('multipart/form-data')", '  @Use(singleFileUpload(ATTACHMENT_FIELD))');
  }

  if (route.csvExport === true) {
    lines.push("  @Produces('text/csv')");
  }

  const parts = [
    ...(route.params === undefined ? [] : [`params: ${route.params}Schema`]),
    ...(route.input === undefined ? [] : [`body: ${route.input}Schema`]),
    ...(route.query === undefined ? [] : [`query: ${route.query}Schema`]),
  ];

  if (parts.length > 0) {
    lines.push(`  @Validate({ ${parts.join(', ')} })`);
  }

  return lines;
}

/** A handler only declares `req` when it actually reads something from the request. */
function readsRequest(view: RouteView): boolean {
  return (
    view.paramsFields.length > 0 ||
    view.bodyType !== null ||
    view.queryType !== null ||
    view.route.locale === true ||
    view.shape.kind === 'upload' ||
    view.shape.kind === 'page'
  );
}

function signatureLines(view: RouteView): string[] {
  const params = readsRequest(view) ? [`req: ${typedRequestOf(view)}`] : [];

  if (view.shape.kind === 'csv') {
    params.push('res: Response');
  }

  const inline = `  async ${view.handler}(${params.join(', ')}): ${view.returnType} {`;

  if (inline.length <= PRINT_WIDTH) {
    return [inline];
  }

  return [
    `  async ${view.handler}(`,
    ...params.map((param) => `    ${param},`),
    `  ): ${view.returnType} {`,
  ];
}

/** `prefix this.service.m(a, b);` — broken one argument per line when it overflows. */
function callLines(prefix: string, callee: string, args: string[], suffix: string): string[] {
  const inline = `    ${prefix}${callee}(${args.join(', ')})${suffix}`;

  if (inline.length <= PRINT_WIDTH) {
    return [inline];
  }

  return [`    ${prefix}${callee}(`, ...args.map((arg) => `      ${arg},`), `    )${suffix}`];
}

function serviceArguments(view: RouteView): string[] {
  const args = view.paramsFields.map((name) => `req.params.${name}`);

  if (view.bodyType !== null) {
    args.push('req.body');
  }

  if (view.queryType !== null && view.shape.kind !== 'csv') {
    args.push('req.query');
  }

  if (view.route.locale === true) {
    args.push(LOCALE_ARGUMENT);
  }

  return args;
}

function bodyLines(blueprint: Blueprint, view: RouteView, root: EntityView): string[] {
  const method = `this.service.${view.serviceMethod}`;

  switch (view.shape.kind) {
    case 'plain':
      return [
        ...(view.route.locale === true ? LOCALE_COMMENT : []),
        ...callLines('return ', method, serviceArguments(view), ';'),
      ];
    case 'void':
      return callLines('await ', method, serviceArguments(view), ';');
    case 'page':
      return [
        ...callLines('const page = await ', method, serviceArguments(view), ';'),
        '',
        '    return ApiPayload.of(page.items, {',
        '      meta: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: req.query.limit },',
        '    });',
      ];
    case 'upload':
      return [
        '    const file = req.file;',
        '',
        '    if (file === undefined) {',
        '      throw new BadRequestError(`A file is required under the "${ATTACHMENT_FIELD}" field`);',
        '    }',
        '',
        ...callLines('return ', method, [...serviceArguments(view), 'file'], ';'),
      ];
    case 'csv':
      return csvBody(blueprint, method);
    case 'envelope':
      return envelopeBody(view, root, method);
  }
}

function csvBody(blueprint: Blueprint, method: string): string[] {
  const filter = blueprint.repository.filter
    .map((field) => `${field}: req.query.${field} ?? null`)
    .join(', ');

  return [
    `    const filename = \`${kebabPlural(blueprint.module.name)}-\${new Date().toISOString().slice(0, 10)}.csv\`;`,
    '',
    "    res.setHeader('Content-Type', 'text/csv; charset=utf-8');",
    '    res.setHeader(\'Content-Disposition\', `attachment; filename="${filename}"`);',
    '',
    ...callLines('await ', method, [`{ ${filter} }`, 'res'], ';'),
  ];
}

function envelopeBody(view: RouteView, root: EntityView, method: string): string[] {
  const entityVar = camelCase(root.name);
  const shape = view.shape;
  const options: string[] = [];

  if (shape.kind === 'envelope' && shape.message !== undefined) {
    const rendered = shape.message.replaceAll(/\{([A-Za-z0-9_]+)\}/g, `\${${entityVar}.$1}`);
    options.push(`message: \`${rendered}\``);
  }

  if (shape.kind === 'envelope' && shape.status !== undefined) {
    options.push(`status: ${shape.status}`);
  }

  const statusDoc = view.route.envelope?.statusDoc;
  const inline = `    return ApiPayload.of(${entityVar}, { ${options.join(', ')} });`;

  return [
    ...(view.route.locale === true ? LOCALE_COMMENT : []),
    ...callLines(`const ${entityVar} = await `, method, serviceArguments(view), ';'),
    '',
    ...(statusDoc === undefined
      ? []
      : (typeof statusDoc === 'string' ? [statusDoc] : statusDoc).map((line) => `    // ${line}`)),
    ...(inline.length <= PRINT_WIDTH
      ? [inline]
      : [
          `    return ApiPayload.of(${entityVar}, {`,
          ...options.map((option) => `      ${option},`),
          '    });',
        ]),
  ];
}

function emitHandler(blueprint: Blueprint, view: RouteView, root: EntityView): string {
  return [
    ...handlerDoc(view),
    ...decoratorLines(view),
    ...signatureLines(view),
    ...bodyLines(blueprint, view, root),
    '  }',
  ].join('\n');
}

function constructorSection(views: RouteView[], root: EntityView): string {
  const serviceClass = `${root.name}Service`;
  const params = [`@inject(${serviceClass}) private readonly service: ${serviceClass}`];

  if (views.some((view) => view.route.locale === true)) {
    params.push('@inject(SHARED_TOKENS.I18n) private readonly i18n: I18nService');
  }

  const inline = `  constructor(${params.join(', ')}) {}`;

  if (params.length === 1 && inline.length <= PRINT_WIDTH) {
    return inline;
  }

  return ['  constructor(', ...params.map((param) => `    ${param},`), '  ) {}'].join('\n');
}

function importSection(
  blueprint: Blueprint,
  views: RouteView[],
  root: EntityView,
  detailType: string,
): string {
  const moduleName = blueprint.module.name;
  const hasCsv = views.some((view) => view.shape.kind === 'csv');
  const hasUpload = views.some((view) => view.shape.kind === 'upload');
  const hasLocale = views.some((view) => view.route.locale === true);
  const hasEnvelope = views.some(
    (view) => view.shape.kind === 'envelope' || view.shape.kind === 'page',
  );

  const lines: string[] = [];

  if (hasCsv) {
    lines.push("import type { Response } from 'express';");
  }

  lines.push("import { inject } from 'tsyringe';", '');

  lines.push(formatImport('import', [...decoratorNames(views)].sort(), '@core/decorators'));

  if (hasUpload) {
    lines.push("import { BadRequestError } from '@core/errors/app-error';");
  }

  if (hasEnvelope) {
    lines.push("import { ApiPayload } from '@core/http/api-response';");
  }

  if (views.some(readsRequest)) {
    lines.push("import type { TypedRequest } from '@core/http/typed-request';");
  }

  if (hasUpload) {
    lines.push(
      "import type { Media } from '@shared/media/media.types';",
      "import { singleFileUpload } from '@shared/media/upload.middleware';",
    );
  }

  if (hasLocale) {
    lines.push(
      "import { SHARED_TOKENS } from '@shared/tokens';",
      "import type { I18nService } from '@shared/utils-services/i18n.service';",
    );
  }

  const schemasPath = `../schemas/${moduleName}.schemas`;
  const schemaNames = new Set<string>();
  const schemaTypes = new Set<string>();

  for (const view of views) {
    for (const ref of [view.route.params, view.route.input, view.route.query]) {
      if (ref !== undefined) {
        schemaNames.add(`${ref}Schema`);
      }
    }

    for (const type of [view.bodyType, view.queryType]) {
      if (type !== null) {
        schemaTypes.add(type);
      }
    }
  }

  if (schemaNames.size > 0) {
    lines.push(formatImport('import', [...schemaNames].sort(), schemasPath));
  }

  if (schemaTypes.size > 0) {
    lines.push(formatImport('import type', [...schemaTypes].sort(), schemasPath));
  }

  const servicePath = `../services/${moduleName}.service`;
  const serviceTypes = returnTypesFrom(views, 'service');

  if (serviceTypes.length > 0) {
    lines.push(formatImport('import type', serviceTypes, servicePath));
  }

  lines.push(`import { ${root.name}Service } from '${servicePath}';`);

  const domainTypes = collectDomainTypes(views, root, detailType);

  if (domainTypes.length > 0) {
    lines.push(formatImport('import type', domainTypes, `../types/${moduleName}.types`));
  }

  const viewTypes = returnTypesFrom(views, 'views');

  if (viewTypes.length > 0) {
    lines.push(formatImport('import type', viewTypes, `../types/${moduleName}.views`));
  }

  return lines.join('\n');
}

/** Element type names returned from a hand-written file (`Attachment[]` → `Attachment`). */
function returnTypesFrom(views: RouteView[], from: 'views' | 'service'): string[] {
  const names = new Set<string>();

  for (const view of views) {
    const returns = view.route.returns;

    if (typeof returns === 'object' && returns.from === from) {
      names.add(returns.type.replace('[]', ''));
    }
  }

  return [...names].sort();
}

function collectDomainTypes(views: RouteView[], root: EntityView, detailType: string): string[] {
  const names = new Set<string>();

  for (const view of views) {
    if (view.shape.kind === 'page') {
      names.add(root.name);
    }

    if (view.shape.kind === 'envelope') {
      names.add(detailType);
    }

    const { returns } = view.route;

    if (view.shape.kind === 'plain' && (returns === undefined || returns === 'detail')) {
      names.add(view.shape.type);
    }

    if (view.paramsType !== null && view.paramsType !== 'IdParams') {
      for (const match of view.paramsType.matchAll(/: ([A-Z][A-Za-z0-9]*)/g)) {
        names.add(match[1] ?? '');
      }
    }
  }

  names.delete('');
  return [...names].sort();
}

function decoratorNames(views: RouteView[]): Set<string> {
  const names = new Set<string>(['Controller']);

  for (const view of views) {
    const { route } = view;
    names.add(pascalCase(route.method));

    if (route.access === 'public') {
      names.add('Public');
    } else if (route.access !== undefined) {
      names.add('Roles');
    }

    if (route.stepUp === true) {
      names.add('StepUp');
    }

    if (route.upload !== undefined) {
      names.add('Consumes');
      names.add('Use');
    }

    if (route.csvExport === true) {
      names.add('Produces');
    }

    if (route.params !== undefined || route.input !== undefined || route.query !== undefined) {
      names.add('Validate');
    }
  }

  return names;
}
