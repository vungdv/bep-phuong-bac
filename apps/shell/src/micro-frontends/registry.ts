import { SHELL_OWNED_ATTRIBUTES } from '@bpb/contracts';
import type { Label, LanguagesConfig } from '@bpb/contracts';

export interface ResolvedApp {
  /** Absolute URL, resolved against the manifest URL. */
  url: string;
  tag: string;
  attributes: Record<string, string>;
  uses: string[];
}

export interface ResolvedRoute {
  /** Normalized: `#/<name>`. */
  path: string;
  app: string;
  label?: Label;
  attributes: Record<string, string>;
}

export interface ResolvedConfig {
  languages: LanguagesConfig;
  home?: string;
  apps: Record<string, ResolvedApp>;
  routes: ResolvedRoute[];
}

/** Global failure: HTTP, parse or validation. Carries every message. */
export class ConfigError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Invalid configuration:\n- ${errors.join('\n- ')}`);
    this.name = 'ConfigError';
    this.errors = errors;
  }
}

export const DEFAULT_LANGUAGES: LanguagesConfig = { supported: ['vi', 'en'], fallback: 'vi' };

const RESERVED_TAGS = new Set([
  'annotation-xml',
  'color-profile',
  'font-face',
  'font-face-src',
  'font-face-uri',
  'font-face-format',
  'font-face-name',
  'missing-glyph',
]);
const TAG_RE = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/;
const ATTR_NAME_RE = /^[a-z][a-z0-9-]*$/;
const ROUTE_PATH_RE = /^#\/[a-z0-9][a-z0-9-]*$/;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function isValidLanguageTag(tag: unknown): tag is string {
  if (typeof tag !== 'string' || tag.length === 0) return false;
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
}

/** `#order`, `/order`, `#/order` -> `#/order`. */
export function normalizeRoutePath(path: string): string {
  return `#/${path.replace(/^#/, '').replace(/^\/+/, '')}`;
}

function resolveUrl(value: string, base: string): string | undefined {
  try {
    return new URL(value, base).href;
  } catch {
    return undefined;
  }
}

function readAttributes(raw: unknown, where: string, errors: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw === undefined) return out;
  if (!isObject(raw)) {
    errors.push(`${where}.attributes must be an object of string values`);
    return out;
  }
  for (const [name, value] of Object.entries(raw)) {
    if (!ATTR_NAME_RE.test(name)) {
      errors.push(`${where}.attributes: invalid attribute name "${name}"`);
    } else if ((SHELL_OWNED_ATTRIBUTES as readonly string[]).includes(name)) {
      errors.push(`${where}.attributes: "${name}" is a shell-owned attribute`);
    } else if (typeof value !== 'string') {
      errors.push(`${where}.attributes.${name} must be a string`);
    } else {
      out[name] = value;
    }
  }
  return out;
}

function readLanguages(raw: unknown, errors: string[]): LanguagesConfig {
  if (raw === undefined) return { ...DEFAULT_LANGUAGES, supported: [...DEFAULT_LANGUAGES.supported] };
  if (!isObject(raw) || !Array.isArray(raw.supported) || typeof raw.fallback !== 'string') {
    errors.push('languages must be { supported: string[], fallback: string }');
    return { ...DEFAULT_LANGUAGES, supported: [...DEFAULT_LANGUAGES.supported] };
  }
  const supported: string[] = [];
  for (const tag of raw.supported) {
    if (isValidLanguageTag(tag)) supported.push(tag);
    else errors.push(`languages.supported: invalid language tag ${JSON.stringify(tag)}`);
  }
  if (!isValidLanguageTag(raw.fallback)) {
    errors.push(`languages.fallback: invalid language tag ${JSON.stringify(raw.fallback)}`);
  } else if (!supported.includes(raw.fallback)) {
    errors.push(`languages.fallback "${raw.fallback}" is not in languages.supported`);
  }
  return { supported, fallback: raw.fallback };
}

function readLabel(raw: unknown, where: string, fallback: string, errors: string[]): Label | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string') {
    if (raw.length === 0) errors.push(`${where}.label must not be empty`);
    return raw;
  }
  if (!isObject(raw)) {
    errors.push(`${where}.label must be a non-empty string or a map of language tag to string`);
    return undefined;
  }
  const map: Record<string, string> = {};
  for (const [lang, text] of Object.entries(raw)) {
    if (!isValidLanguageTag(lang)) errors.push(`${where}.label: invalid language tag "${lang}"`);
    else if (!isNonEmptyString(text)) errors.push(`${where}.label.${lang} must be a non-empty string`);
    else map[lang] = text;
  }
  if (!(fallback in map)) errors.push(`${where}.label is missing the fallback language "${fallback}"`);
  return map;
}

function findCycles(apps: Record<string, ResolvedApp>, errors: string[]): void {
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const reported = new Set<string>();
  const visit = (id: string): void => {
    state.set(id, 1);
    stack.push(id);
    for (const dep of apps[id]?.uses ?? []) {
      if (dep === id || !apps[dep]) continue;
      if (state.get(dep) === 1) {
        const cycle = [...stack.slice(stack.indexOf(dep)), dep];
        const key = [...cycle.slice(0, -1)].sort().join(',');
        if (!reported.has(key)) {
          reported.add(key);
          errors.push(`apps: "uses" cycle ${cycle.join(' -> ')}`);
        }
      } else if (!state.has(dep)) {
        visit(dep);
      }
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of Object.keys(apps)) if (!state.has(id)) visit(id);
}

export interface ValidateInput {
  host: unknown;
  /** undefined when `routesUrl` is absent. */
  routes?: unknown;
  /** Absolute manifest URL. */
  manifestUrl: string;
}

/**
 * Validate both files together. Collects every error; throws ConfigError if any.
 * Unknown fields (including the deferred `layout`) are dropped.
 */
export function validateHostConfig({ host, routes, manifestUrl }: ValidateInput): ResolvedConfig {
  const errors: string[] = [];
  if (!isObject(host)) throw new ConfigError(['host.config.json must be a JSON object']);

  const languages = readLanguages(host.languages, errors);

  if (host.routesUrl !== undefined && typeof host.routesUrl !== 'string') {
    errors.push('routesUrl must be a string');
  }

  const apps: Record<string, ResolvedApp> = {};
  const rawApps = host.apps ?? {};
  const tagOwner = new Map<string, string>();
  const rawUses: Record<string, unknown> = {};
  if (!isObject(rawApps)) {
    errors.push('apps must be an object');
  } else {
    for (const [id, entry] of Object.entries(rawApps)) {
      const where = `apps.${id}`;
      if (!isObject(entry)) {
        errors.push(`${where} must be an object`);
        continue;
      }
      let url = '';
      if (!isNonEmptyString(entry.url)) errors.push(`${where}.url is required`);
      else {
        const resolved = resolveUrl(entry.url, manifestUrl);
        if (resolved === undefined) errors.push(`${where}.url "${entry.url}" is not a valid URL`);
        else url = resolved;
      }
      const tag = entry.tag;
      if (!isNonEmptyString(tag)) errors.push(`${where}.tag is required`);
      else if (!TAG_RE.test(tag) || RESERVED_TAGS.has(tag)) {
        errors.push(`${where}.tag "${tag}" is not a valid custom element name`);
      } else if (tagOwner.has(tag)) {
        errors.push(`${where}.tag "${tag}" duplicates apps.${tagOwner.get(tag)}.tag`);
      } else tagOwner.set(tag, id);
      rawUses[id] = entry.uses;
      apps[id] = {
        url,
        tag: typeof tag === 'string' ? tag : '',
        attributes: readAttributes(entry.attributes, where, errors),
        uses: [],
      };
    }
    for (const [id, app] of Object.entries(apps)) {
      const uses = rawUses[id];
      if (uses === undefined) continue;
      if (!Array.isArray(uses) || !uses.every((u) => typeof u === 'string')) {
        errors.push(`apps.${id}.uses must be an array of app ids`);
        continue;
      }
      for (const dep of uses as string[]) {
        if (dep === id) errors.push(`apps.${id}.uses must not reference itself`);
        else if (!(dep in apps)) errors.push(`apps.${id}.uses references unknown app "${dep}"`);
        else app.uses.push(dep);
      }
    }
    findCycles(apps, errors);
  }

  let home: string | undefined;
  if (host.home !== undefined) {
    if (typeof host.home !== 'string' || !(host.home in apps)) {
      errors.push(`home "${String(host.home)}" is not an app id`);
    } else home = host.home;
  }

  const resolvedRoutes: ResolvedRoute[] = [];
  if (routes !== undefined) {
    const rawRoutes = isObject(routes) ? (routes.routes ?? []) : undefined;
    if (!Array.isArray(rawRoutes)) {
      errors.push('routes.config.json must be an object with a "routes" array');
    } else {
      const seen = new Set<string>();
      rawRoutes.forEach((entry: unknown, i) => {
        const where = `routes[${i}]`;
        if (!isObject(entry)) {
          errors.push(`${where} must be an object`);
          return;
        }
        let path = '';
        if (typeof entry.path !== 'string') errors.push(`${where}.path is required`);
        else {
          path = normalizeRoutePath(entry.path);
          if (!ROUTE_PATH_RE.test(path)) errors.push(`${where}.path "${entry.path}" is invalid`);
          else if (seen.has(path)) errors.push(`${where}.path "${entry.path}" duplicates route "${path}"`);
          else seen.add(path);
        }
        const app = entry.app;
        if (typeof app !== 'string' || !(app in apps)) {
          errors.push(`${where}.app "${String(app)}" is not an app id in host.config.json`);
        }
        const label = readLabel(entry.label, where, languages.fallback, errors);
        const route: ResolvedRoute = {
          path,
          app: typeof app === 'string' ? app : '',
          attributes: readAttributes(entry.attributes, where, errors),
        };
        if (label !== undefined) route.label = label;
        resolvedRoutes.push(route);
      });
    }
  }

  if (errors.length > 0) throw new ConfigError(errors);
  const result: ResolvedConfig = { languages, apps, routes: resolvedRoutes };
  if (home !== undefined) result.home = home;
  return result;
}

export interface ConfigLoaderOptions {
  fetch?: typeof fetch;
  /** Extra request headers for both config fetches (e.g. traceparent, added later). */
  headers?: Record<string, string>;
  /** Base used when the manifest URL is relative. Defaults to `location.href`. */
  baseUrl?: string;
  /** Expected routesUrl (e.g. './routes.config.json'); enables fetching it in parallel with the manifest. */
  routesUrlHint?: string;
}

export class ConfigLoader {
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;
  private readonly baseUrl: string | undefined;
  private readonly routesUrlHint: string | undefined;

  constructor(options: ConfigLoaderOptions = {}) {
    this.fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.headers = options.headers ?? {};
    this.baseUrl = options.baseUrl;
    this.routesUrlHint = options.routesUrlHint;
  }

  /** Fetch manifest and route map, then validate them together. */
  async load(manifestUrl: string): Promise<ResolvedConfig> {
    const base = this.baseUrl ?? (globalThis as { location?: { href: string } }).location?.href;
    const absolute = resolveUrl(manifestUrl, base as string);
    if (absolute === undefined) throw new ConfigError([`Invalid manifest URL "${manifestUrl}"`]);

    // routesUrl lives inside the manifest, so a true parallel fetch needs a hint: when
    // `routesUrlHint` is given, the route map is requested together with the manifest and
    // reused if the manifest declares the same URL (otherwise refetched; ignored if absent).
    const hintUrl = this.routesUrlHint ? resolveUrl(this.routesUrlHint, absolute) : undefined;
    const hintPromise = hintUrl
      ? this.fetchJson(hintUrl, 'routes.config.json').then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        )
      : undefined;
    const host = await this.fetchJson(absolute, 'host.config.json');
    let routes: unknown;
    if (isObject(host) && typeof host.routesUrl === 'string') {
      const routesUrl = resolveUrl(host.routesUrl, absolute);
      if (routesUrl === undefined) throw new ConfigError([`routesUrl "${host.routesUrl}" is not a valid URL`]);
      if (hintPromise && routesUrl === hintUrl) {
        const settled = await hintPromise;
        if (!settled.ok) throw settled.error;
        routes = settled.value;
      } else {
        routes = await this.fetchJson(routesUrl, 'routes.config.json');
      }
    } else if (hintPromise) {
      await hintPromise;
    }
    return validateHostConfig({ host, routes, manifestUrl: absolute });
  }

  private async fetchJson(url: string, name: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { cache: 'no-cache', headers: this.headers });
    } catch (e) {
      throw new ConfigError([`${name}: request failed (${e instanceof Error ? e.message : String(e)})`]);
    }
    if (!res.ok) throw new ConfigError([`${name}: HTTP ${res.status}`]);
    try {
      return await res.json();
    } catch {
      throw new ConfigError([`${name}: invalid JSON`]);
    }
  }
}
