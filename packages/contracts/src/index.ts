// Types and constants only. No runtime behavior (spec: Integration contract).

/** Prefix for every cross-app event name. */
export const MF_EVENT_PREFIX = 'mf:' as const;

/** app -> shell: request navigation. Detail: NavigateDetail. */
export const MF_NAVIGATE = 'mf:navigate' as const;

/** [Deferred, reserved] header -> shell: language switch. Not handled in v1. */
export const MF_LANGUAGE_CHANGE = 'mf:language-change' as const;

export interface NavigateDetail {
  path: string;
}

/** [Deferred, reserved] Detail of MF_LANGUAGE_CHANGE. */
export interface LanguageChangeDetail {
  lang: string;
}

/** Shell-owned attribute names. The manifest may not set them. */
export const ATTR_LANG = 'lang' as const;
export const ATTR_ROUTE = 'route' as const;
/** [Deferred, reserved] header only. */
export const ATTR_NAV = 'nav' as const;
/** [Deferred, reserved] header only. */
export const ATTR_LANGUAGES = 'languages' as const;

export const SHELL_OWNED_ATTRIBUTES = [
  ATTR_LANG,
  ATTR_ROUTE,
  ATTR_NAV,
  ATTR_LANGUAGES,
] as const;

export type ShellOwnedAttribute = (typeof SHELL_OWNED_ATTRIBUTES)[number];

/** Localized text: a plain string or a map of BCP 47 tag -> string. */
export type Label = string | Record<string, string>;

export interface AppEntry {
  url: string;
  tag: string;
  attributes?: Record<string, string>;
  /** Ids of apps the shell loads in parallel with this one (not transitive). */
  uses?: string[];
}

export interface RouteEntry {
  path: string;
  app: string;
  label?: Label;
  attributes?: Record<string, string>;
}

/** [Deferred, reserved] Entry of the header's `nav` attribute. */
export interface NavItem {
  path: string;
  label: Label;
}

export interface LanguagesConfig {
  supported: string[];
  fallback: string;
}

/** [Deferred, reserved] Layout regions. Not built in v1. */
export interface LayoutConfig {
  header?: { app: string; attributes?: Record<string, string> };
}

/** Shape of host.config.json. */
export interface HostConfig {
  languages?: LanguagesConfig;
  home?: string;
  routesUrl?: string;
  apps: Record<string, AppEntry>;
  /** [Deferred, reserved] */
  layout?: LayoutConfig;
}

/** Shape of routes.config.json. */
export interface RoutesConfig {
  routes: RouteEntry[];
}
