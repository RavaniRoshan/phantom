/**
 * Page layout modes (`mode` frontmatter), Mintlify's names for what a page
 * shows around its content:
 *
 * - `default`: the sidebar, the page's title and table of contents, and the
 *   page-end links, around the prose column.
 * - `wide`: no table of contents; the content takes its width.
 * - `center`: no sidebar or table of contents; a wider column, centered.
 *   For changelogs and other pages read top to bottom.
 * - `custom`: only the header. No sidebar, title, breadcrumbs, table of
 *   contents, page-end links, or site footer, and the content spans the
 *   page, for a landing page written in MDX.
 * - `frame`: `custom`, keeping the sidebar.
 *
 * Mintlify's `assistant` mode, a full-page chat, has no equivalent.
 */
export const PAGE_MODES = [
  "default",
  "wide",
  "center",
  "custom",
  "frame",
] as const;

export type PageMode = (typeof PAGE_MODES)[number];

/** What a page shows around its content, and how wide the content runs. */
export interface PageModeLayout {
  /** The page's own chrome: title, description, breadcrumbs, page-end links, and the site footer. */
  chrome: boolean;
  sidebar: boolean;
  toc: boolean;
  /** `content` is the prose measure, `center` a wider centered column, `full` the whole column. */
  width: "content" | "center" | "full";
}

/** The layout a mode gives a page. */
export const pageModeLayout = (mode: PageMode = "default"): PageModeLayout => {
  switch (mode) {
    case "wide": {
      return { chrome: true, sidebar: true, toc: false, width: "full" };
    }
    case "center": {
      return { chrome: true, sidebar: false, toc: false, width: "center" };
    }
    case "custom": {
      return { chrome: false, sidebar: false, toc: false, width: "full" };
    }
    case "frame": {
      return { chrome: false, sidebar: true, toc: false, width: "full" };
    }
    default: {
      return { chrome: true, sidebar: true, toc: true, width: "content" };
    }
  }
};
