/**
 * Single-character trimming, done without regular expressions.
 *
 * The obvious spellings — `/^\/+/`, `/\/+$/`, `/^\/+|\/+$/g` — take quadratic
 * time on a run of the trimmed character, because a failed match at one start
 * position tells the engine nothing about the next one. Every caller here trims
 * a value that comes from outside Blume (a configured route, a spec URL, a site
 * origin), so the slow path is reachable from user input rather than only from
 * our own literals. These loops are linear and allocation-free.
 */

/** Drop every leading `char` (`"///a"` -> `"a"` for `"/"`). */
export const trimStart = (text: string, char: string): string => {
  let start = 0;
  while (start < text.length && text[start] === char) {
    start += 1;
  }
  return text.slice(start);
};

/** Drop every trailing `char` (`"a///"` -> `"a"` for `"/"`). */
export const trimEnd = (text: string, char: string): string => {
  let end = text.length;
  while (end > 0 && text[end - 1] === char) {
    end -= 1;
  }
  return text.slice(0, end);
};

/** Drop every leading *and* trailing `char` (`"///a///"` -> `"a"`). */
export const trimChar = (text: string, char: string): string =>
  trimEnd(trimStart(text, char), char);
