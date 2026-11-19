/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MANIFEST_URL: string;
  readonly VITE_LOAD_TIMEOUT_MS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
