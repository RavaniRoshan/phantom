import { createRequire } from "node:module";

/**
 * Node's own `require`, for the SDKs and heavy modules Blume loads only when a
 * feature needs them. Resolution starts from this file, inside the installed
 * package, exactly like the `import()` it stands in for, and Node 22.12+ loads
 * ES modules through it too.
 *
 * Never `import()` in their place. When Node can't import the generated Astro
 * config itself — it refuses to strip types from TypeScript under
 * `node_modules`, which is where an installed Blume's runtime source lives —
 * Astro evaluates the config, and every Blume module it reaches, in a Vite
 * module runner that it closes as soon as the config has loaded. A dynamic
 * `import()` in one of those modules resolves through that runner, so a call
 * made any later (an `astro:build:done` hook, a Markdown plugin) throws "Vite
 * module runner has been closed". `require` is Node's, so it works however the
 * calling module was evaluated. The repo itself never sees the failure: its
 * workspace link puts Blume outside `node_modules`, so Node imports the config
 * natively.
 */
export const nodeRequire = createRequire(import.meta.url);
