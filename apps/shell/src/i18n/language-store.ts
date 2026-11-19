export const LANGUAGE_STORAGE_KEY = 'mf:language';

/** Reads the stored language choice. Tolerates unavailable or throwing storage. */
export function readStoredLanguage(storage?: Pick<Storage, 'getItem'>): string | null {
  try {
    const target = storage ?? globalThis.localStorage;
    return target.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Writes the language choice. Returns false when storage is unavailable. */
export function writeStoredLanguage(lang: string, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    const target = storage ?? globalThis.localStorage;
    target.setItem(LANGUAGE_STORAGE_KEY, lang);
    return true;
  } catch {
    return false;
  }
}

/** Reads `navigator.languages`; empty when missing. */
export function getBrowserLanguages(nav?: { readonly languages?: readonly string[] }): readonly string[] {
  try {
    const source = nav ?? globalThis.navigator;
    const list = source?.languages;
    return Array.isArray(list) || (list && typeof list.length === 'number') ? Array.from(list) : [];
  } catch {
    return [];
  }
}
