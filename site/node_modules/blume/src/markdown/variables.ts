import { substituteVariables } from "../core/variables.ts";
import type { ContentVariables } from "../core/variables.ts";
import type { MdastNode, MdastValue } from "./mdast.ts";

/**
 * The Markdown half of content variables (see `core/variables.ts`): a Sätteri
 * MDAST plugin that replaces `{{name}}` in a plain `.md` page's text, code,
 * raw HTML, and link and image destinations. A `.md` page has no expressions,
 * so every reference survives parsing as text and can be replaced here; MDX
 * pages are substituted before they're parsed instead (`astro/variables.ts`).
 * Nodes change through `setProperty`, not by mutating the node object.
 */

interface VariableContext {
  setProperty: (node: MdastNode, key: string, value: string) => void;
}

const isText = (value: MdastValue): value is string =>
  typeof value === "string";

/** The node properties that can hold a reference, per node type. */
const FIELDS = {
  code: ["value"],
  definition: ["url", "title"],
  html: ["value"],
  image: ["url", "title", "alt"],
  inlineCode: ["value"],
  link: ["url", "title"],
  text: ["value"],
} as const;

export const variablesPlugin = (variables: ContentVariables) => {
  const replaceIn =
    (keys: readonly string[]) =>
    (node: MdastNode, ctx: VariableContext): void => {
      for (const key of keys) {
        const value = node[key];
        if (value !== undefined && isText(value)) {
          const next = substituteVariables(value, variables);
          if (next !== value) {
            ctx.setProperty(node, key, next);
          }
        }
      }
    };
  return {
    code: replaceIn(FIELDS.code),
    definition: replaceIn(FIELDS.definition),
    html: replaceIn(FIELDS.html),
    image: replaceIn(FIELDS.image),
    inlineCode: replaceIn(FIELDS.inlineCode),
    link: replaceIn(FIELDS.link),
    name: "blume-variables",
    text: replaceIn(FIELDS.text),
  };
};
