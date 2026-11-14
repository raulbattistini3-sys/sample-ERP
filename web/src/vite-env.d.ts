/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  // "development", "dev.*" or "production": dev-only tools (Gerar dados fictícios, timings) need "dev..."
  readonly VITE_ENVIRONMENT?: string;
  // "true" / "false"; unset follows the mode (shown by the dev server, hidden in builds)
  readonly VITE_SEARCH_TIMINGS?: string;
  // "rest" (default) or "socket": how the product list reaches the API; ?transport= overrides it
  readonly VITE_PRODUCTS_TRANSPORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
