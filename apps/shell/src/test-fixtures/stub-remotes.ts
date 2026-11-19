import { ATTR_LANG, ATTR_ROUTE, MF_NAVIGATE } from '@bpb/contracts';

/**
 * Test fixtures: stub remotes defined by functions so each test can use unique tag names and inject
 * them through the loader's `importer`. Idempotent: defining an already-defined tag is a no-op.
 */

/** Child: renders `lang` + text in its shadow root; its button dispatches `mf:navigate` (bubbles + composed). */
export function defineStubChild(tag: string): void {
  if (customElements.get(tag)) return;
  customElements.define(
    tag,
    class extends HTMLElement {
      static observedAttributes = [ATTR_LANG];
      private readonly shadow = this.attachShadow({ mode: 'open' });
      constructor() {
        super();
        this.render();
      }
      attributeChangedCallback(): void {
        this.render();
      }
      /** Dispatches `mf:navigate` with `{ path }`; crosses the parent's shadow boundary. */
      navigate(path: string): void {
        this.dispatchEvent(
          new CustomEvent(MF_NAVIGATE, { detail: { path }, bubbles: true, composed: true }),
        );
      }
      private render(): void {
        const lang = this.getAttribute(ATTR_LANG) ?? '';
        this.shadow.innerHTML = '<span data-lang></span><button type="button"></button>';
        const span = this.shadow.querySelector('span');
        if (span) span.textContent = `child:${lang}`;
        const button = this.shadow.querySelector('button');
        if (button) {
          button.textContent = 'go';
          button.addEventListener('click', () => this.navigate(this.getAttribute('nav-path') ?? '#/'));
        }
      }
    },
  );
}

export interface StubMasterOptions {
  tag: string;
  childTag: string;
  /** How long to wait for the child to be defined before rendering the fallback. */
  childWaitMs?: number;
}

/**
 * Master: observes `lang` and `route`, shows the route, and renders `<childTag>` in its shadow root once
 * defined (forwarding `lang`), or a `[data-fallback]` element if the child is still undefined after the wait.
 */
export function defineStubMaster({ tag, childTag, childWaitMs = 30 }: StubMasterOptions): void {
  if (customElements.get(tag)) return;
  customElements.define(
    tag,
    class extends HTMLElement {
      static observedAttributes = [ATTR_LANG, ATTR_ROUTE];
      private readonly shadow = this.attachShadow({ mode: 'open' });
      private child: HTMLElement | undefined;
      private started = false;
      private readonly routeEl = document.createElement('p');
      private readonly content = document.createElement('div');
      constructor() {
        super();
        this.routeEl.dataset['route'] = '';
        this.shadow.append(this.routeEl, this.content);
      }
      connectedCallback(): void {
        this.sync();
        if (this.started) return;
        this.started = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, childWaitMs);
        });
        void Promise.race([customElements.whenDefined(childTag).then(() => undefined), timeout]).then(() => {
          clearTimeout(timer);
          if (customElements.get(childTag)) {
            this.child = document.createElement(childTag);
            this.content.replaceChildren(this.child);
          } else {
            const fb = document.createElement('div');
            fb.dataset['fallback'] = '';
            fb.textContent = 'child unavailable';
            this.content.replaceChildren(fb);
          }
          this.sync();
        });
      }
      attributeChangedCallback(): void {
        this.sync();
      }
      private sync(): void {
        this.routeEl.textContent = this.getAttribute(ATTR_ROUTE) ?? '';
        const lang = this.getAttribute(ATTR_LANG);
        if (this.child && lang !== null) this.child.setAttribute(ATTR_LANG, lang);
      }
    },
  );
}
