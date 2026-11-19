import { beforeEach, describe, expect, it } from 'vitest';
import { extractPropertyRules, injectPropertyRules, PROPERTIES_STYLE_ID } from './shadow-css';

const css = `.a{color:red}@property --tw-x{syntax:"*";inherits:false;initial-value:0}
@property --tw-y { syntax: "*"; inherits: false }
.b{margin:0}`;

describe('shadow-css', () => {
  beforeEach(() => document.getElementById(PROPERTIES_STYLE_ID)?.remove());

  it('extracts only @property blocks', () => {
    const out = extractPropertyRules(css);
    expect(out).toContain('@property --tw-x');
    expect(out).toContain('@property --tw-y');
    expect(out).not.toContain('.a');
    expect(out).not.toContain('.b');
  });

  it('returns empty string when there are none', () => {
    expect(extractPropertyRules('.a{color:red}')).toBe('');
  });

  it('injects once into document.head', () => {
    injectPropertyRules(css);
    injectPropertyRules(css);
    expect(document.head.querySelectorAll(`#${PROPERTIES_STYLE_ID}`)).toHaveLength(1);
  });

  it('injects nothing without @property rules', () => {
    injectPropertyRules('.a{}');
    expect(document.getElementById(PROPERTIES_STYLE_ID)).toBeNull();
  });
});
