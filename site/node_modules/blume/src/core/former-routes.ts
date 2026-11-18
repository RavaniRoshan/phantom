import { normalizePath, stripBasePath, withBasePath } from "./base-path.ts";
import type { ResolvedConfig } from "./schema.ts";
import type { PageRecord } from "./types.ts";

type Redirect = ResolvedConfig["redirects"][number];

/**
 * Redirects from the routes an earlier Blume published pages at
 * (`PageRecord.formerRoute`) to where they publish now, so a date-named
 * page's old URL keeps working. None is added where the old URL is still
 * served (another page, or a custom page, lives there now), where an authored
 * redirect already starts, or where two pages once resolved to it: that was a
 * duplicate route, which failed the build, so the URL never served either.
 * Both ends are written base-less, like authored redirects.
 */
export const formerRouteRedirects = (
  pages: readonly PageRecord[],
  served: ReadonlySet<string>,
  config: Pick<ResolvedConfig, "basePath" | "redirects">
): Redirect[] => {
  const targets = new Map<string, string | undefined>();
  for (const page of pages) {
    if (page.formerRoute !== undefined) {
      targets.set(
        page.formerRoute,
        targets.has(page.formerRoute) ? undefined : page.route
      );
    }
  }
  const authored = new Set(
    config.redirects.map((redirect) =>
      normalizePath(withBasePath(config.basePath, redirect.from))
    )
  );
  return [...targets].flatMap(([from, to]) =>
    to === undefined || served.has(from) || authored.has(from)
      ? []
      : [
          {
            from: stripBasePath(config.basePath, from),
            status: 301,
            to: stripBasePath(config.basePath, to),
          } satisfies Redirect,
        ]
  );
};
