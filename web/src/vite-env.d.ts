/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  // "true" / "false"; unset follows the mode (shown by the dev server, hidden in builds)
  readonly VITE_SEARCH_TIMINGS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
