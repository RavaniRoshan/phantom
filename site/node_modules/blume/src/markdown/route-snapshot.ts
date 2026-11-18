import { readFileSync, statSync } from "node:fs";

import { resolve } from "pathe";

import { readRuntimeModule } from "../astro/runtime-modules.ts";
import type { RuntimeModuleId } from "../astro/runtime-modules.ts";

/**
 * A reader for a runtime module snapshot a Markdown plugin consults: the text
 * the CLI publishes under `id`, or — in an ejected app, with no CLI in the
 * process — the file eject writes for it (`file`), re-read only when it
 * changes. Resolves to `undefined` when neither is available.
 */
export const snapshotReader = (
  id: RuntimeModuleId,
  file?: string
): (() => string | undefined) => {
  const path = file ? resolve(file) : undefined;
  let fileStamp: number | undefined;
  let fileText: string | undefined;

  /** The ejected snapshot file's text, re-read only when it changes. */
  const readFile = (target: string): string | undefined => {
    let stamp: number;
    try {
      stamp = statSync(target).mtimeMs;
    } catch {
      return undefined;
    }
    if (stamp !== fileStamp) {
      fileStamp = stamp;
      fileText = readFileSync(target, "utf-8");
    }
    return fileText;
  };

  return () => readRuntimeModule(id) ?? (path ? readFile(path) : undefined);
};

/**
 * A reader for the `blume:data` snapshot the Markdown link plugins consult for
 * the site's routes: the text the CLI publishes, or the snapshot file an
 * ejected app aliases (`dataFile`).
 */
export const routeSnapshotReader = (
  dataFile?: string
): (() => string | undefined) => snapshotReader("blume:data", dataFile);
