/**
 * Links that open in a new tab. Every such link Blume renders — chrome (header
 * actions, featured sidebar links, page actions), content components (Card,
 * Tile, Tooltip), and Markdown links under `markdown.externalLinks` — points
 * `aria-describedby` at one hidden, localized "Opens in a new tab" element each
 * layout renders once per page, so screen-reader users hear the same warning
 * sighted readers get from the arrow icon or the new tab itself.
 */

import { isExternalUrl } from "./base-path.ts";

/** The id of the layout's hidden "Opens in a new tab" description. */
export const NEW_TAB_HINT_ID = "blume-new-tab-hint";

/** The attributes a new-tab link carries (spread onto an `<a>`). */
export interface NewTabAttrs {
  "aria-describedby"?: string;
  rel?: string;
  target?: string;
}

/** A link that always opens in a new tab (a repo link, an edit link). */
export const NEW_TAB_ATTRS: NewTabAttrs = {
  "aria-describedby": NEW_TAB_HINT_ID,
  rel: "noreferrer",
  target: "_blank",
};

/**
 * {@link NEW_TAB_ATTRS} for an external href (the shared `isExternalUrl`
 * predicate), and nothing for a site route, fragment, or `mailto:` link, which
 * stay in the current tab.
 */
export const newTabAttrs = (href?: string): NewTabAttrs =>
  href !== undefined && isExternalUrl(href) ? NEW_TAB_ATTRS : {};
