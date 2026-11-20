/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Orchard Core base URL, e.g. http://localhost:5080. Public value, never a secret. */
  readonly VITE_BACKEND_URL?: string;
  /** OpenID Connect authority; defaults to VITE_BACKEND_URL. */
  readonly VITE_OIDC_AUTHORITY?: string;
  /** Public client id registered in the backend (default bpb-orders-ui). Never a secret. */
  readonly VITE_OIDC_CLIENT_ID?: string;
}
