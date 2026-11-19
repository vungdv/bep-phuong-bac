export interface ResolveLanguageInput {
  /** Tag stored from a previous user choice (deferred in v1: nothing writes it). */
  readonly stored: string | null | undefined;
  /** `navigator.languages`, in preference order. */
  readonly browser: readonly string[];
  readonly supported: readonly string[];
  readonly fallback: string;
}

/** Canonicalize a BCP 47 tag, or null when it is invalid. */
function canonicalize(tag: string): string | null {
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch {
    return null;
  }
}

function baseOf(canonical: string): string {
  return canonical.split('-')[0] ?? canonical;
}

/** Pure: picks one supported tag (returned as spelled in `supported`). */
export function resolveLanguage(input: ResolveLanguageInput): string {
  const { stored, browser, supported, fallback } = input;
  const entries = supported.flatMap((tag) => {
    const canonical = canonicalize(tag);
    return canonical === null ? [] : [{ tag, canonical, base: baseOf(canonical) }];
  });

  if (stored) {
    const canonical = canonicalize(stored);
    const hit = canonical === null ? undefined : entries.find((e) => e.canonical === canonical);
    if (hit) return hit.tag;
  }

  for (const raw of browser) {
    const canonical = canonicalize(raw);
    if (canonical === null) continue;
    const exact = entries.find((e) => e.canonical === canonical);
    if (exact) return exact.tag;
    const base = entries.find((e) => e.base === baseOf(canonical));
    if (base) return base.tag;
  }

  return fallback;
}
