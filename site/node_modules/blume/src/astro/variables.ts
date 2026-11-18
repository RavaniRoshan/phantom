import { substituteVariables } from "../core/variables.ts";
import type { ContentVariables } from "../core/variables.ts";

/**
 * The MDX half of content variables (see `core/variables.ts`): a Vite plugin
 * that replaces `{{name}}` in an `.mdx` module's source before the MDX
 * compiler reads it. It has to run first: the compiler parses `{{version}}`
 * as a JavaScript expression (a `ReferenceError` at render) and rejects
 * `{{api-url}}` outright, so no plugin after parsing could see either.
 */
/** The Vite plugin slice this needs (structurally typed, like Blume's other plugins). */
export interface VariablesVitePlugin {
  enforce: "pre";
  name: string;
  transform: (code: string, id: string) => { code: string; map: null } | null;
}

export const variablesVitePlugin = (
  variables: ContentVariables
): VariablesVitePlugin => ({
  enforce: "pre",
  name: "blume:variables",
  transform(code, id) {
    const [path = ""] = id.split("?");
    if (!path.endsWith(".mdx")) {
      return null;
    }
    const next = substituteVariables(code, variables);
    return next === code ? null : { code: next, map: null };
  },
});
