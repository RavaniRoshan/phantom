import { jsxAttribute, jsxFlowElement, jsxTextElement } from "./mdast.ts";
import type { MdastNode, MdastVisitorContext } from "./mdast.ts";

interface MathNode extends MdastNode {
  value: string;
}

/**
 * Satteri MDAST plugin that turns math nodes into Blume's `<Math>` component,
 * which renders them with KaTeX at build time. `$$…$$` on its own lines is
 * block math and becomes a display element; `$$…$$` inside a sentence is
 * inline math and stays inline. The parser runs with `singleDollarTextMath:
 * false`, so a single `$` (currency, a shell variable) never opens math.
 */
export const mathPlugin = () => ({
  inlineMath(node: MathNode, ctx: MdastVisitorContext) {
    ctx.replaceNode(
      node,
      jsxTextElement("Math", [jsxAttribute("code", node.value)])
    );
  },
  math(node: MathNode, ctx: MdastVisitorContext) {
    ctx.replaceNode(
      node,
      jsxFlowElement(
        "Math",
        [jsxAttribute("code", node.value), jsxAttribute("display")],
        []
      )
    );
  },
  name: "blume-math",
});
