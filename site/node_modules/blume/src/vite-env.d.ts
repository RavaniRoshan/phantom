// Ambient types for the Vite `import.meta.env` fields Blume's client islands read
// (`.astro` files aren't typechecked, so only real `.ts`/`.tsx` sources need this).
interface ImportMetaEnv {
  /** Deployment base path, always with a trailing slash (e.g. `/` or `/docs/`). */
  readonly BASE_URL: string;
  readonly DEV: boolean;
  readonly MODE: string;
  readonly PROD: boolean;
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
