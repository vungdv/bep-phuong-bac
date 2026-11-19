import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslator } from '../../i18n/messages';
import { createOutlet } from './outlet';

let root: HTMLElement;
let n = 0;
const uniqueTag = () => `x-outlet-test-${++n}`;

function make(lang = 'vi') {
  const onRetry = vi.fn();
  const t = createTranslator({ lang, fallback: 'en', warn: () => {} });
  const outlet = createOutlet({ root, t, lang, onRetry });
  return { outlet, onRetry, t };
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => root.remove());

describe('Outlet views', () => {
  it('loading has role=status and aria-busy=true', () => {
    const { outlet, t } = make();
    outlet.showLoading();
    const v = root.querySelector('[role="status"]');
    expect(v?.getAttribute('aria-busy')).toBe('true');
    expect(v?.textContent).toBe(t('outlet.loading'));
  });

  it('error has role=alert and Retry calls onRetry with scope', () => {
    const { outlet, onRetry, t } = make();
    outlet.showError('route', ['boom <b>x</b>']);
    const v = root.querySelector('[role="alert"]');
    expect(v).not.toBeNull();
    expect(v?.textContent).toContain('boom <b>x</b>');
    expect(v?.querySelector('b')).toBeNull();
    expect(v?.textContent).toContain(t('outlet.error.title'));
    root.querySelector('button')?.click();
    expect(onRetry).toHaveBeenCalledWith('route');
    outlet.showError('global', []);
    expect(root.textContent).toContain(t('outlet.globalError.title'));
    root.querySelector('button')?.click();
    expect(onRetry).toHaveBeenLastCalledWith('global');
  });

  it('not-found names hash and links home', () => {
    const { outlet } = make('en');
    outlet.showNotFound('#/nope');
    expect(root.textContent).toContain('#/nope');
    const a = root.querySelector('a');
    expect(a?.getAttribute('href')).toBe('#/');
    expect(a?.textContent).toBe('Go home');
  });

  it('not-found renders hash as text (XSS safe)', () => {
    const { outlet } = make();
    outlet.showNotFound('#/<img onerror=x>');
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('#/<img onerror=x>');
  });

  it('home without routes says no apps, in vi and en', () => {
    make('vi').outlet.showHome([]);
    expect(root.textContent).toBe('Chưa có ứng dụng nào được đăng ký.');
    root.replaceChildren();
    make('en').outlet.showHome([]);
    expect(root.textContent).toBe('No apps registered.');
  });

  it('home lists routes as links with label or path', () => {
    const { outlet } = make('en');
    outlet.showHome([{ path: '#/a', label: 'Alpha' }, { path: '#/b' }]);
    const links = [...root.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#/a', '#/b']);
    expect(links.map((a) => a.textContent)).toEqual(['Alpha', '#/b']);
    expect(root.querySelector('h1')?.textContent).toBe('Apps');
  });

  it('uses Vietnamese vs English copy', () => {
    make('vi').outlet.showLoading();
    expect(root.textContent).toBe('Đang tải…');
    make('en').outlet.showLoading();
    expect(root.textContent).toBe('Loading…');
  });

  it('shows exactly one view at a time', () => {
    const { outlet } = make();
    outlet.showLoading();
    outlet.showNotFound('#/x');
    outlet.showHome([]);
    expect(root.children).toHaveLength(1);
    expect(root.querySelector('[role="status"]')).toBeNull();
  });
});

describe('Outlet mount', () => {
  it('sets attributes before append, shell-owned last and winning', () => {
    const tag = uniqueTag();
    let seen: Record<string, string> = {};
    let order: string[] = [];
    customElements.define(
      tag,
      class extends HTMLElement {
        connectedCallback() {
          seen = Object.fromEntries([...this.attributes].map((a) => [a.name, a.value]));
          order = [...this.attributes].map((a) => a.name);
        }
      },
    );
    const { outlet } = make('en');
    outlet.mount({
      tag,
      attributes: { foo: 'bar', lang: 'xx', route: '#/hijack' },
      hash: '#/real',
    });
    expect(seen).toEqual({ foo: 'bar', lang: 'en', route: '#/real' });
    expect(order[0]).toBe('foo');
    expect(root.firstElementChild?.tagName.toLowerCase()).toBe(tag);
  });

  it('updateRoute updates in place without remount', () => {
    const tag = uniqueTag();
    let connected = 0;
    customElements.define(
      tag,
      class extends HTMLElement {
        connectedCallback() {
          connected++;
        }
      },
    );
    const { outlet } = make();
    outlet.updateRoute('#/noop');
    outlet.mount({ tag, hash: '#/a' });
    const first = root.firstElementChild;
    outlet.updateRoute('#/a/2');
    expect(root.firstElementChild).toBe(first);
    expect(first?.getAttribute('route')).toBe('#/a/2');
    expect(connected).toBe(1);
  });

  it('switching view removes the old element; updateRoute then no-ops', () => {
    const { outlet } = make();
    outlet.mount({ tag: 'div', hash: '#/a' });
    const old = root.firstElementChild;
    outlet.showLoading();
    expect(old?.isConnected).toBe(false);
    outlet.updateRoute('#/b');
    expect(old?.getAttribute('route')).toBe('#/a');
    outlet.mount({ tag: 'section', hash: '#/c' });
    expect(root.children).toHaveLength(1);
    outlet.dispose();
    expect(root.childNodes).toHaveLength(0);
  });
});
