/**
 * The heading a page's title came from. A page without a frontmatter `title`
 * takes the text of its first `#` heading as its title (`deriveTitle` in
 * `core/sources/normalize.ts`), and the page template renders that title as
 * the page's `<h1>`, so a page that opens with the heading showed it twice,
 * one above the other. This Satteri hast plugin drops that opening `<h1>`
 * from such a page. Only a Markdown heading with nothing rendered before it
 * counts: a raw HTML or JSX `<h1>` isn't the scan's heading, and one after
 * other content stays where it is. A page in a mode without page chrome
 * (`custom`, `frame`) renders no title, so its heading stays too.
 *
 * It runs after `heading-anchors`, so every other heading keeps the id the
 * scan gave it (`setup`, `setup-1`): only the title's own element goes. Its
 * id doesn't: the anchor index lists it, and links to `#setup` still land,
 * because the dropped heading's id goes out through the render's front matter
 * under {@link TITLE_ID_KEY}, which the page template sets on its `<h1>`.
 */

import { pageModeLayout } from "../core/page-modes.ts";
import type { PageMode } from "../core/page-modes.ts";

/**
 * Front matter key carrying the id of the heading this plugin dropped out of
 * a render. The page template reads it back via `remarkPluginFrontmatter` and
 * gives the title `<h1>` it renders in the heading's place that id.
 */
export const TITLE_ID_KEY = "blumeTitleId";

/** A minimal hast node (avoids a hast type dependency). */
interface HastNode {
  children?: HastNode[];
  /** An element's properties: a heading's `id` is the slug `heading-anchors` set. */
  properties?: { id?: string };
  type: string;
  value?: string;
}

/** The front matter keys this plugin reads and writes. */
interface TitleFrontmatter {
  [TITLE_ID_KEY]?: string;
  mode?: PageMode;
  title?: string;
}

/** The slice of Satteri's hast visitor context this plugin reads. */
interface TitleHeadingContext {
  data?: { astro?: { frontmatter?: TitleFrontmatter } };
  indexOf: (node: HastNode) => number | undefined;
  parent: (node: HastNode) => HastNode | undefined;
  removeNode: (node: HastNode) => void;
}

/** A Satteri hast plugin, typed structurally to avoid a Satteri dep. */
export interface TitleHeadingPlugin {
  before: (root: HastNode, ctx: TitleHeadingContext) => void;
  name: string;
  element: {
    filter: string[];
    visit: (node: HastNode, ctx: TitleHeadingContext) => void;
  };
}

// An MDX expression that is only a comment, `{/* … */}`, and raw HTML that is
// only a comment, `<!-- … -->`.
const COMMENT_EXPRESSION = /^\s*\/\*[\s\S]*\*\/\s*$/u;
const HTML_COMMENT = /^\s*<!--[\s\S]*-->\s*$/u;

/** Whether a node renders nothing: whitespace, a comment, or an MDX import. */
const rendersNothing = (node: HastNode): boolean => {
  switch (node.type) {
    case "comment":
    case "mdxjsEsm": {
      return true;
    }
    case "text": {
      return (node.value ?? "").trim() === "";
    }
    case "mdxFlowExpression": {
      return COMMENT_EXPRESSION.test(node.value ?? "");
    }
    case "raw": {
      return HTML_COMMENT.test(node.value ?? "");
    }
    default: {
      return false;
    }
  }
};

// The renders whose first `<h1>` has been seen. The plugin instance is shared
// across every page; the render-scoped `astro` data object is a stable,
// unique key for one render (as in `heading-anchors`).
const seen = new WeakSet<object>();

export const titleHeadingPlugin = (): TitleHeadingPlugin => ({
  // A render of an entry Astro rendered before can get the front matter
  // object that render wrote to, so a heading dropped then leaves no id.
  before(_root, ctx) {
    const frontmatter = ctx.data?.astro?.frontmatter;
    if (frontmatter) {
      Reflect.deleteProperty(frontmatter, TITLE_ID_KEY);
    }
  },
  element: {
    filter: ["h1"],
    visit(node, ctx) {
      const astro = ctx.data?.astro;
      const frontmatter = astro?.frontmatter;
      if (
        !(astro && frontmatter) ||
        frontmatter.title ||
        node.type !== "element" ||
        seen.has(astro)
      ) {
        return;
      }
      seen.add(astro);
      const parent = ctx.parent(node);
      const before = parent?.children?.slice(0, ctx.indexOf(node) ?? 0) ?? [];
      if (
        parent?.type === "root" &&
        before.every(rendersNothing) &&
        pageModeLayout(frontmatter.mode).chrome
      ) {
        const id = node.properties?.id;
        if (id) {
          frontmatter[TITLE_ID_KEY] = id;
        }
        ctx.removeNode(node);
      }
    },
  },
  name: "blume:title-heading",
});
