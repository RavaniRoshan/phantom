/**
 * Rewrite a bare `--host` in the raw argv to `--host=` before citty parses it.
 *
 * `host` is a string arg (citty has no mixed string/boolean type), and citty
 * 0.2 parses with `node:util.parseArgs`, where a string option consumes the
 * next token as its value even when that token is another flag: `blume dev
 * --host --open` would bind the literal hostname "--open" and drop `--open`.
 * The `--host=` spelling parses as `""` without touching its neighbor, which
 * `normalizeHost` then maps to Astro's "bind all interfaces".
 */
export const normalizeHostArgs = (rawArgs: readonly string[]): string[] =>
  rawArgs.map((arg, index) => {
    if (arg !== "--host") {
      return arg;
    }
    const next = rawArgs[index + 1];
    return next === undefined || next.startsWith("-") ? "--host=" : arg;
  });

/**
 * Resolve a `--host` flag value into what Astro/Vite's `server.host` expects.
 * citty has no mixed string/boolean arg type, so `host` is declared as a
 * string and a bare `--host` parses as `""` (`normalizeHostArgs` rewrites it
 * to `--host=` first) — Node would bind all interfaces for `""`, but Vite's
 * `resolveHostname` treats it as a literal hostname and prints malformed URLs
 * like `http://:4321/`. Match Astro's own `--host` semantics instead: bare
 * flag → `true` (bind all interfaces), `--host 10.0.0.1` → that address,
 * absent → `false` (localhost only).
 *
 * Lives beside `normalizeHostArgs` rather than in `commands/dev.ts` so
 * `preview` can share it without importing the whole dev command graph.
 */
export const normalizeHost = (host?: string): boolean | string =>
  host === "" ? true : (host ?? false);
