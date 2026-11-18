/** Edit distance between two short strings (insertions, deletions, swaps of one letter). */
const distance = (from: string, to: string): number => {
  let previous = Array.from({ length: to.length + 1 }, (_, index) => index);
  for (const [row, fromChar] of [...from].entries()) {
    const current = [row + 1];
    for (const [column, toChar] of [...to].entries()) {
      current.push(
        Math.min(
          (previous[column + 1] ?? 0) + 1,
          (current[column] ?? 0) + 1,
          (previous[column] ?? 0) + (fromChar === toChar ? 0 : 1)
        )
      );
    }
    previous = current;
  }
  return previous[to.length] ?? 0;
};

/**
 * The candidate closest to `name`, when it's close enough to be the likely
 * intent: at most two edits away, and fewer edits than half the candidate's
 * length, so a short typo doesn't "suggest" an unrelated short word.
 */
export const closestMatch = (
  name: string,
  candidates: readonly string[]
): string | undefined => {
  let best: { candidate: string; edits: number } | undefined;
  for (const candidate of candidates) {
    const edits = distance(name, candidate);
    if (
      edits <= 2 &&
      edits * 2 < candidate.length &&
      (best === undefined || edits < best.edits)
    ) {
      best = { candidate, edits };
    }
  }
  return best?.candidate;
};
