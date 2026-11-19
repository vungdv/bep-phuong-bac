import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { LocalStorageOrdersApi } from './api/local-storage-orders-api';
import type { OrdersApi } from './api/orders-api';
import { App } from './app';
import { resolveLang } from './i18n/messages';
import { injectPropertyRules } from './shadow-css';
import styles from './styles.css?inline';

class OrdersAppElement extends HTMLElement {
  static observedAttributes = ['lang', 'route'];

  /** Test seam: set before connecting to replace the localStorage mock. */
  api?: OrdersApi;

  private root: Root | null = null;
  private queryClient: QueryClient | null = null;
  private resolvedApi: OrdersApi | null = null;

  connectedCallback(): void {
    if (this.root) return;
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    if (!shadow.querySelector('style')) {
      const style = document.createElement('style');
      style.textContent = styles;
      shadow.appendChild(style);
    }
    injectPropertyRules(styles);
    const mount = document.createElement('div');
    shadow.appendChild(mount);
    this.queryClient = new QueryClient();
    this.resolvedApi = this.api ?? new LocalStorageOrdersApi(localStorage, 'bpb.orders', Date);
    this.root = createRoot(mount);
    this.render();
  }

  disconnectedCallback(): void {
    this.root?.unmount();
    this.root = null;
    this.queryClient?.clear();
    this.queryClient = null;
    this.shadowRoot?.querySelector('div')?.remove();
  }

  attributeChangedCallback(name: string): void {
    // `route` is accepted and ignored in v1.
    if (name === 'lang') this.render();
  }

  private render(): void {
    if (!this.root || !this.queryClient || !this.resolvedApi) return;
    this.root.render(
      createElement(App, {
        lang: resolveLang(this.getAttribute('lang')),
        api: this.resolvedApi,
        queryClient: this.queryClient,
      }),
    );
  }
}

if (!customElements.get('orders-app')) {
  customElements.define('orders-app', OrdersAppElement);
}
