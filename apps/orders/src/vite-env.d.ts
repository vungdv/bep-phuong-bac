/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `orchard` selects OrchardOrdersApi; anything else keeps the localStorage mock. */
  readonly VITE_ORDERS_API?: string;
  /** Orchard Core base URL, e.g. http://localhost:5080. Public value, never a secret. */
  readonly VITE_BACKEND_URL?: string;
}
