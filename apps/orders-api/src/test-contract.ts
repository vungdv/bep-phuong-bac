import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { parse } from 'yaml';
import { expect } from 'vitest';

/** Test helper: validates HTTP responses against openapi.yaml so the spec and the code cannot drift. */
export const OPENAPI_PATH = fileURLToPath(new URL('../openapi.yaml', import.meta.url));

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;
const SPEC_ID = 'https://orders-api.test/openapi.yaml';

export interface ContractResponse {
  statusCode: number;
  headers: Record<string, unknown>;
  body: string;
}

export function loadOpenApi(): Json {
  return parse(readFileSync(OPENAPI_PATH, 'utf8')) as Json;
}

export function createContract() {
  const doc = loadOpenApi();
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats.default(ajv);
  ajv.addSchema(doc, SPEC_ID);
  const compiled = new Map<string, ReturnType<typeof ajv.compile>>();

  /** Compile the schema at a JSON pointer inside the document (inner $refs resolve against the same document). */
  function validatorAt(pointer: string) {
    let fn = compiled.get(pointer);
    if (!fn) compiled.set(pointer, (fn = ajv.compile({ $ref: `${SPEC_ID}#${pointer}` })));
    return fn;
  }
  const esc = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');
  const deref = (node: Json): Json => {
    if (typeof node.$ref !== 'string') return node;
    return node.$ref
      .slice(2)
      .split('/')
      .reduce<Json>((n, k) => n[k.replace(/~1/g, '/').replace(/~0/g, '~')], doc);
  };

  const templates = Object.keys(doc.paths as Json).map((t) => ({
    template: t,
    re: new RegExp(`^${t.replace(/\{[^}]+\}/g, '[^/]+')}$`),
  }));

  /** Throws when `res` (for `method` + concrete `url`) is not a documented response. */
  function assertResponse(method: string, url: string, res: ContractResponse): void {
    const m = method.toLowerCase();
    if (m === 'options') return; // CORS preflight is not part of the REST contract
    const path = url.split('?')[0]!;
    const match = templates.find((t) => t.re.test(path));
    const status = String(res.statusCode);
    let responseNode: Json | undefined;
    let pointerBase: string;
    if (!match) {
      // Unknown path: every API returns the shared 404 Problem.
      expect(res.statusCode, `${method} ${url} has no path in openapi.yaml`).toBe(404);
      responseNode = doc.components.responses.NotFound;
      pointerBase = '/components/responses/NotFound';
    } else {
      const pathItem = doc.paths[match.template] as Json;
      const op = pathItem[m === 'head' ? 'get' : m] as Json | undefined; // HEAD is answered by GET
      if (op) {
        const raw = op.responses?.[status] as Json | undefined;
        expect(raw, `${method} ${match.template} documents no ${status} response`).toBeDefined();
        responseNode = deref(raw!);
        pointerBase = raw!.$ref ? (raw!.$ref as string).slice(1) : `/paths/${esc(match.template)}/${m === 'head' ? 'get' : m}/responses/${status}`;
      } else {
        // Undocumented method: the shared 405 response, with Allow = this path's documented methods (+HEAD for GET).
        expect(res.statusCode, `${method} ${match.template} is undocumented and must answer 405`).toBe(405);
        const documented = HTTP_METHODS.filter((x) => pathItem[x]).flatMap((x) => (x === 'get' ? ['GET', 'HEAD'] : [x.toUpperCase()]));
        expect(res.headers.allow, `${method} ${url}: Allow must list the documented methods`).toBe(documented.join(', '));
        responseNode = doc.components.responses.MethodNotAllowed;
        pointerBase = '/components/responses/MethodNotAllowed';
      }
    }

    // Headers: every documented header must be present when required, and match its schema.
    for (const [name, h] of Object.entries<Json>(responseNode!.headers ?? {})) {
      const header = deref(h);
      const value = res.headers[name.toLowerCase()];
      if (value === undefined) {
        expect(header.required ?? false, `${method} ${url}: missing required header ${name}`).toBe(false);
        continue;
      }
      const schema = { ...header.schema };
      delete schema.examples;
      const ok = ajv.compile(schema)(String(value));
      expect(ok, `${method} ${url}: header ${name}=${String(value)} violates its schema`).toBe(true);
    }

    // Body: media type must be documented and the payload must satisfy its schema.
    if (m === 'head') return; // HEAD mirrors GET headers and carries no body
    const content = (responseNode!.content ?? {}) as Json;
    const contentType = String(res.headers['content-type'] ?? '').split(';')[0]!.trim();
    if (Object.keys(content).length === 0) {
      expect(res.body, `${method} ${url}: ${status} documents no body`).toBe('');
      return;
    }
    expect(Object.keys(content), `${method} ${url}: undocumented media type ${contentType}`).toContain(contentType);
    const schemaPointer = `${pointerBase}/content/${esc(contentType)}/schema`;
    const validate = validatorAt(schemaPointer);
    const valid = validate(JSON.parse(res.body));
    expect(valid, `${method} ${url}: ${JSON.stringify(validate.errors)}`).toBe(true);
  }

  /** Drop-in for `app.inject(...)` that also asserts the response matches the contract. */
  async function inject(app: FastifyInstance, opts: string | InjectOptions) {
    const o: InjectOptions = typeof opts === 'string' ? { url: opts } : opts;
    const res = await app.inject(o);
    assertResponse(String(o.method ?? 'GET'), String(o.url ?? o.path), res);
    return res;
  }

  return { doc, assertResponse, inject };
}
