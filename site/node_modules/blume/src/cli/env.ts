import { existsSync } from "node:fs";

import { config } from "dotenv";
import { dirname, join, resolve } from "pathe";

// Blume's remote sources (GitHub Releases, mdx-remote, Sanity, Notion…) read
// their tokens from `process.env` during the content scan — which runs before
// Astro/Vite boots, so Vite's own `.env` loading is too late. This loader fills
// that gap: it cascades `.env`/`.env.local` from the working dir up to the repo
// root, so a monorepo can keep one `.env` at the root and every app picks it up.

/**
 * Load `.env`/`.env.local`, cascading from `startDir` up to the repository root
 * (the first ancestor containing a `.git`) or the filesystem root. The ordered
 * path list is handed to dotenv, whose `config` is first-wins, never clobbers
 * existing `process.env` values, and treats unreadable files as best-effort —
 * so shell/CI overrides are never lost, `.env.local` layers over `.env`, and a
 * bad file never aborts a build. dotenv is also the parser Vite runs over
 * these files at build time, so a value means the same thing to the pre-boot
 * content scan and the built site — including multi-line double-quoted values
 * (PEM keys), which a line-based parser silently truncates.
 *
 * `NODE_ENV` is never taken from these files: it picks the mode Vite and Astro
 * run in, so a monorepo root `.env` that sets it for another app would turn
 * every `blume build` into a development build (or `blume dev` into a
 * production one).
 */
export const loadEnvFiles = (startDir: string): void => {
  const paths: string[] = [];
  let dir = resolve(startDir);
  let done = false;
  while (!done) {
    paths.push(join(dir, ".env.local"), join(dir, ".env"));
    const parent = dirname(dir);
    // Stop at the repo root (nearest `.git`) or the filesystem root.
    done = existsSync(join(dir, ".git")) || parent === dir;
    dir = parent;
  }
  const loaded: Record<string, string> = {};
  config({ path: paths, processEnv: loaded, quiet: true });
  for (const [key, value] of Object.entries(loaded)) {
    if (key !== "NODE_ENV" && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
};
