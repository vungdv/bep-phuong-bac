import { ATTR_LANG, ATTR_ROUTE } from '@bpb/contracts';
import type { Translate } from '../../i18n/messages';

export type ErrorScope = 'global' | 'route';

export interface OutletRoute {
  readonly path: string;
  readonly label?: unknown;
}

export interface OutletMountSpec {
  readonly tag: string;
  /** Pre-merged app + route attributes; shell-owned names are overridden. */
  readonly attributes?: Readonly<Record<string, string>>;
  readonly hash: string;
}

export interface OutletOptions {
  readonly root: HTMLElement;
  readonly t: Translate;
  readonly lang: string;
  readonly onRetry: (scope: ErrorScope) => void;
}

export interface Outlet {
  showLoading(): void;
  showHome(routes: readonly OutletRoute[]): void;
  showNotFound(hash: string): void;
  showError(scope: ErrorScope, errors: readonly string[]): void;
  mount(spec: OutletMountSpec): void;
  updateRoute(hash: string): void;
  dispose(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function toHref(path: string): string {
  return path.startsWith('#') ? path : `#${path.startsWith('/') ? '' : '/'}${path}`;
}

export function createOutlet(options: OutletOptions): Outlet {
  const { root, t, lang, onRetry } = options;
  let mounted: HTMLElement | undefined;

  function replace(...nodes: Node[]): void {
    mounted = undefined;
    root.replaceChildren(...nodes);
  }

  function homeLink(): HTMLAnchorElement {
    const a = el('a', t('outlet.goHome'));
    a.setAttribute('href', '#/');
    return a;
  }

  return {
    showLoading() {
      const view = el('div', t('outlet.loading'));
      view.setAttribute('role', 'status');
      view.setAttribute('aria-busy', 'true');
      view.dataset['view'] = 'loading';
      replace(view);
    },

    showHome(routes) {
      const view = el('div');
      view.dataset['view'] = 'home';
      if (routes.length === 0) {
        view.append(el('p', t('outlet.noApps')));
      } else {
        view.append(el('h1', t('outlet.routes.heading')));
        const list = el('ul');
        for (const route of routes) {
          const li = el('li');
          const a = el('a', typeof route.label === 'string' ? route.label : route.path);
          a.setAttribute('href', toHref(route.path));
          li.append(a);
          list.append(li);
        }
        view.append(list);
      }
      replace(view);
    },

    showNotFound(hash) {
      const view = el('div');
      view.dataset['view'] = 'not-found';
      view.append(
        el('h1', t('outlet.notFound.title')),
        el('p', t('outlet.notFound.body', { hash })),
        homeLink(),
      );
      replace(view);
    },

    showError(scope, errors) {
      const view = el('div');
      view.setAttribute('role', 'alert');
      view.dataset['view'] = 'error';
      view.dataset['scope'] = scope;
      view.append(
        el('h1', t(scope === 'global' ? 'outlet.globalError.title' : 'outlet.error.title')),
        el('p', t('outlet.error.body')),
      );
      if (errors.length > 0) {
        const list = el('ul');
        for (const message of errors) list.append(el('li', message));
        view.append(list);
      }
      const retry = el('button', t('outlet.retry'));
      retry.setAttribute('type', 'button');
      retry.addEventListener('click', () => onRetry(scope));
      view.append(retry);
      replace(view);
    },

    mount({ tag, attributes, hash }) {
      const element = document.createElement(tag);
      for (const [name, value] of Object.entries(attributes ?? {})) {
        element.setAttribute(name, value);
      }
      element.setAttribute(ATTR_LANG, lang);
      element.setAttribute(ATTR_ROUTE, hash);
      replace(element);
      mounted = element;
    },

    updateRoute(hash) {
      mounted?.setAttribute(ATTR_ROUTE, hash);
    },

    dispose() {
      replace();
    },
  };
}
