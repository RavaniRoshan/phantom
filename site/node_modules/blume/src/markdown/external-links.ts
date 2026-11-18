/**
 * Opens external Markdown links in a new tab (`markdown.externalLinks`). A
 * Satteri hast plugin: every `<a>` whose href passes the shared
 * `isExternalUrl` predicate — the one behind the header actions and featured
 * sidebar links — gets `target="_blank"`, `rel="noreferrer"`, an
 * `aria-describedby` pointing at the layout's hidden "Opens in a new tab"
 * element, and a `data-blume-external` marker the theme draws the arrow icon
 * from. So a Markdown link and a chrome link to the same place behave alike.
 *
 * Site routes, fragments, relative paths, and other schemes (`mailto:`,
 * `tel:`) stay in the current tab. Raw `<a>` tags written in Markdown, and JSX
 * or components in MDX, keep whatever attributes their author gave them. Only
 * constructed when the option is on (see `markdown/index.ts`).
 */

import { isExternalUrl } from "../core/base-path.ts";
import { NEW_TAB_HINT_ID } from "../core/new-tab.ts";

/** A hast property value: an attribute primitive or a token list. */
type HastPropertyValue = string | number | boolean | (string | number)[];

/** A minimal hast node (avoids a hast type dependency). */
interface HastNode {
  properties?: Record<string, HastPropertyValue>;
  tagName?: string;
  type: string;
}

/**
 * The slice of Satteri's hast visitor context this plugin needs. Satteri
 * serializes an unchanged node by identity, so attributes are recorded via
 * `setProperty` rather than by mutating `node.properties`.
 */
interface HastContext {
  setProperty: (node: HastNode, key: string, value: HastPropertyValue) => void;
}

/** A Satteri hast plugin, typed structurally to avoid a Satteri dep. */
export interface ExternalLinksPlugin {
  name: string;
  element: {
    filter: string[];
    visit: (node: HastNode, ctx: HastContext) => void;
  };
}

/** Only a string href can be tested; hast allows numbers and token lists. */
const isHref = (value: HastPropertyValue | undefined): value is string =>
  typeof value === "string";

export const externalLinksPlugin = (): ExternalLinksPlugin => ({
  element: {
    filter: ["a"],
    visit(node, ctx) {
      const href = node.properties?.href;
      if (isHref(href) && isExternalUrl(href)) {
        ctx.setProperty(node, "target", "_blank");
        ctx.setProperty(node, "rel", ["noreferrer"]);
        ctx.setProperty(node, "ariaDescribedBy", [NEW_TAB_HINT_ID]);
        ctx.setProperty(node, "dataBlumeExternal", "");
      }
    },
  },
  name: "blume:external-links",
});
