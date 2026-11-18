import { mkdir } from "node:fs/promises";

import { dirname } from "pathe";
import writeFileAtomic from "write-file-atomic";

/**
 * Write text to `path` atomically (unique temp file + rename) after ensuring
 * the parent directory exists, so a concurrent reader or file watcher never
 * observes a missing or half-written file. write-file-atomic's temp names are
 * unique per call — a pid-suffixed temp name is not, and two concurrent
 * writers to the same target in one process (translate lanes, staged-content
 * writes) would interleave through a shared temp file. `fsync` is off to
 * match the previous behavior: the point is watcher atomicity, not crash
 * durability, and a per-file fsync would slow dev regeneration.
 */
export const writeTextAtomic = async (
  path: string,
  text: string
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, text, { encoding: "utf-8", fsync: false });
};
