/**
 * Related pages: the `related` frontmatter list a page ends with, as Mintlify
 * writes it. Each entry is a root-relative path to another page, an absolute
 * URL, or a one-key `{ Title: link }` object that names the link itself. A
 * page link resolves to the served route, in the reader's locale when that
 * page is translated, and takes the page's own title and description; an
 * internal path that matches no page is left out here and reported by the
 * link checker, which sees every entry as one of the page's links.
 */
import { isExternalUrl, normalizeRoute, withBasePath } from "./base-path.ts";
import type { LocaleRouting } from "./i18n.ts";
import { localizeLinkPath, routeSetFor } from "./locale-links.ts";
import type { PageLink } from "./types.ts";

/** The most entries a page lists, as on Mintlify. */
export const MAX_RELATED = 10;

/** A `{ Title: link }` entry: the one key is the title, its value the link. */
export interface TitledRelatedEntry {
  [title: string]: string;
}

/** One `related` frontmatter entry. */
export type RelatedEntry = string | TitledRelatedEntry;

/** A resolved entry, ready to render. */
export interface RelatedLink {
  description?: string;
  external: boolean;
  /** A page's route (`basePath` included, deployment base not), or a URL. */
  href: string;
  title: string;
}

/** A served route, as the data snapshot lists it. */
export interface RelatedRoute {
  description: string | null;
  path: string;
  title: string;
}

/** What resolving needs from the site. */
export interface RelatedContext {
  basePath: string;
  /** The site's locales, when it has more than one. */
  i18n?: LocaleRouting | null;
  /** The locale of the page being rendered. */
  locale: string;
  routes: readonly RelatedRoute[];
}

/** An entry's link and, for a titled entry, its title. */
interface EntryParts {
  link: string;
  title?: string;
}

const isPath = (entry: RelatedEntry): entry is string =>
  typeof entry === "string";

const partsOf = (entry: RelatedEntry): EntryParts | undefined => {
  if (isPath(entry)) {
    return { link: entry };
  }
  const [first] = Object.entries(entry);
  return first ? { link: first[1], title: first[0] } : undefined;
};

/** The links a page's `related` entries name, in the order written. */
export const relatedLinks = (
  entries: readonly RelatedEntry[] | false | undefined,
  context: RelatedContext
): RelatedLink[] => {
  if (!entries) {
    return [];
  }
  const served = routeSetFor(context.routes);
  return entries.flatMap((entry): RelatedLink[] => {
    const parts = partsOf(entry);
    if (!parts) {
      return [];
    }
    if (isExternalUrl(parts.link)) {
      return [
        {
          external: true,
          href: parts.link,
          title: parts.title ?? new URL(parts.link, "https://x").hostname,
        },
      ];
    }
    const at = parts.link.search(/[#?]/u);
    const path = at === -1 ? parts.link : parts.link.slice(0, at);
    const suffix = at === -1 ? "" : parts.link.slice(at);
    const authored = withBasePath(context.basePath, normalizeRoute(path));
    const route = context.i18n
      ? localizeLinkPath(authored, {
          basePath: context.basePath,
          i18n: context.i18n,
          locale: context.locale,
          routes: served,
        })
      : authored;
    const page = context.routes.find((candidate) => candidate.path === route);
    if (!page) {
      return [];
    }
    return [
      {
        description: page.description ?? undefined,
        external: false,
        href: `${route}${suffix}`,
        title: parts.title ?? page.title,
      },
    ];
  });
};

/**
 * A page's `related` page links, as links the checker validates like any in
 * its body. Front matter has no line map, so they point at its first line.
 */
export const relatedPageLinks = (
  entries?: readonly RelatedEntry[] | false
): PageLink[] =>
  (entries || []).flatMap((entry) => {
    const link = partsOf(entry)?.link;
    return link && !isExternalUrl(link)
      ? [{ column: 1, line: 1, target: link }]
      : [];
  });
