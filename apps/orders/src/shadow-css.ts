export const PROPERTIES_STYLE_ID = 'bpb-orders-properties';

/** Extracts every top-level `@property --x { ... }` block (they are ignored inside shadow roots). */
export function extractPropertyRules(css: string): string {
  return (css.match(/@property\s+--[\w-]+\s*\{[^{}]*\}/g) ?? []).join('\n');
}

/** @property registrations are document-global: inject them once into document.head. */
export function injectPropertyRules(css: string, doc: Document = document): void {
  if (doc.getElementById(PROPERTIES_STYLE_ID)) return;
  const rules = extractPropertyRules(css);
  if (!rules) return;
  const style = doc.createElement('style');
  style.id = PROPERTIES_STYLE_ID;
  style.textContent = rules;
  doc.head.appendChild(style);
}
