#!/usr/bin/env node
// Blume CLI launcher.
//
// The published package ships a Node-compatible bundle in dist/cli/ — the entry
// index.js plus the code-split command chunks it imports, built by
// scripts/build.ts — and the launcher prefers it. When it is absent —
// e.g. running from a source checkout — it falls back to the TypeScript source,
// which requires a TS-aware runtime such as Bun (`bun bin/blume.mjs <cmd>`).
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = import.meta.dirname;
const built = path.join(here, "..", "dist", "cli", "index.js");
const source = path.join(here, "..", "src", "cli", "index.ts");

const entry = existsSync(built) ? built : source;

await import(pathToFileURL(entry).href);
