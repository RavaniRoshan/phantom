import { z } from "zod";

import type { AdapterDescriptor } from "../core/adapter.ts";
import { adapterDescriptorSchema } from "../core/adapter.ts";
import type { SharedSourceOptions } from "./shared.ts";
import { DEFAULT_CONTENT_GLOB, sharedSourceOptionsSchema } from "./shared.ts";

/** What `include` defaults to: every Markdown/MDX file under the root. */
export const DEFAULT_CONTENT_INCLUDE = [DEFAULT_CONTENT_GLOB];
/** What `exclude` always holds: underscore- and dot-prefixed paths. */
export const DEFAULT_CONTENT_EXCLUDE = ["**/_*", "**/.*"];

/**
 * A source's `exclude` as the scan applies it: the defaults, plus the
 * author's patterns. A `!pattern` entry takes that exact pattern back out, a
 * default included, so `["!**\/_*"]` publishes `_`-prefixed files. The glob
 * library can't negate an ignore pattern itself.
 */
export const resolveContentExclude = (
  patterns: readonly string[]
): string[] => {
  const kept = new Set(
    patterns.flatMap((pattern) =>
      pattern.startsWith("!") ? [pattern.slice(1)] : []
    )
  );
  return [
    ...new Set([
      ...DEFAULT_CONTENT_EXCLUDE,
      ...patterns.filter((pattern) => !pattern.startsWith("!")),
    ]),
  ].filter((pattern) => !kept.has(pattern));
};

/** Options for {@link filesystem}. */
export interface FilesystemOptions extends SharedSourceOptions {
  /**
   * Glob patterns to ignore, on top of `["**\/_*", "**\/.*"]`. A `!pattern`
   * entry stops ignoring that pattern, a default included.
   */
  exclude?: string[];
  /** Glob patterns to include. Defaults to `["**\/*.{md,mdx}"]`. */
  include?: string[];
  /** Directory to read from, relative to the project root. Defaults to `docs`. */
  root?: string;
}

export const filesystemOptionsSchema = sharedSourceOptionsSchema.extend({
  exclude: z.array(z.string()).default([]).transform(resolveContentExclude),
  include: z.array(z.string()).default(DEFAULT_CONTENT_INCLUDE),
  root: z.string().default("docs"),
});

export type FilesystemAdapter = AdapterDescriptor<
  "filesystem",
  FilesystemOptions
>;

export const filesystemAdapterSchema = adapterDescriptorSchema(
  "filesystem",
  filesystemOptionsSchema
);

/**
 * Local Markdown/MDX read from a directory. The zero-config default: with no
 * `content.sources`, the top-level `content.root`/`include`/`exclude` desugar
 * to exactly one of these.
 */
export const filesystem = (
  options: FilesystemOptions = {}
): FilesystemAdapter => ({
  kind: "filesystem",
  options,
  requiredSecrets: [],
  runtimeDeps: [],
});
