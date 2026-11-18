import { phrasingMarkdown } from "./directives.ts";
import { jsxAttribute, jsxFlowElement } from "./mdast.ts";
import type { MdastNode, MdastVisitorContext } from "./mdast.ts";

/**
 * The callout each GitHub alert renders as. `IMPORTANT` has no callout of its
 * own and reads as a note (`:::important` does too), and `CAUTION` — GitHub's
 * red "risks or negative outcomes" alert — as danger.
 */
export const ALERT_CALLOUTS: ReadonlyMap<string, string> = new Map([
  ["caution", "danger"],
  ["important", "note"],
  ["note", "note"],
  ["tip", "tip"],
  ["warning", "warning"],
]);

// `[!NOTE]` opening a quote's first line, any case, as GitHub reads it.
const ALERT_MARKER = /^\[!(?<kind>[a-z]+)\]/iu;

/** An alert marker as written (`[!NOTE]`) and the callout it renders as. */
export interface AlertMarker {
  callout: string;
  marker: string;
}

/** The alert marker a quote's first text opens with, if any. */
export const alertMarkerOf = (text: string): AlertMarker | undefined => {
  const match = ALERT_MARKER.exec(text);
  const callout = ALERT_CALLOUTS.get(match?.groups?.kind?.toLowerCase() ?? "");
  return match && callout ? { callout, marker: match[0] } : undefined;
};

/** The visitor-context slice the alert visitor uses. */
interface AlertVisitorContext extends MdastVisitorContext {
  parent?: (node: MdastNode) => MdastNode | undefined;
  source?: string;
}

/** The node's children. */
const childrenOf = (node: MdastNode | undefined): MdastNode[] =>
  // SAFETY: a parent's `children` is always a node list; leaves carry none.
  (node?.children ?? []) as MdastNode[];

/** A text node's value, or undefined for any other node. */
const textOf = (node: MdastNode | undefined): string | undefined =>
  node?.type === "text" ? String(node.value) : undefined;

/** A text node's start offset into the page, when the parse recorded one. */
const startOffset = (node: MdastNode): number | undefined => {
  // SAFETY: Satteri positions carry numeric offsets.
  const position = node.position as { start?: { offset?: number } } | undefined;
  return position?.start?.offset;
};

/** The alert a blockquote opens with: its callout type and first paragraph. */
interface Alert {
  paragraph: MdastNode;
  type: string;
}

/**
 * The alert a blockquote is, or undefined. Its first paragraph must open with
 * the marker as written: an escaped `\[!NOTE]` (text once parsed) starts with
 * a backslash in the page.
 */
const alertOf = (node: MdastNode, source: string): Alert | undefined => {
  const [paragraph] = childrenOf(node);
  const first = childrenOf(paragraph).at(0);
  const text = textOf(first);
  if (paragraph?.type !== "paragraph" || first === undefined || !text) {
    return undefined;
  }
  const marker = alertMarkerOf(text);
  const offset = startOffset(first);
  if (
    marker === undefined ||
    (offset !== undefined && source[offset] === "\\")
  ) {
    return undefined;
  }
  return { paragraph, type: marker.callout };
};

/** A paragraph's phrasing split at its first line break. */
interface Lines {
  first: MdastNode[];
  rest: MdastNode[];
}

/** Split phrasing at its first line break: a newline in text, or a hard break. */
const splitFirstLine = (nodes: readonly MdastNode[]): Lines => {
  for (const [index, node] of nodes.entries()) {
    const after = nodes.slice(index + 1);
    if (node.type === "break") {
      return { first: nodes.slice(0, index), rest: after };
    }
    const newline = textOf(node)?.indexOf("\n") ?? -1;
    if (newline !== -1) {
      const value = String(node.value);
      const head = value.slice(0, newline);
      const tail = value.slice(newline + 1);
      return {
        first: [...nodes.slice(0, index), { type: "text", value: head }],
        rest: tail === "" ? after : [{ type: "text", value: tail }, ...after],
      };
    }
  }
  return { first: [...nodes], rest: [] };
};

/**
 * A GitHub alert as a `<Callout>`: the marker comes off the first line, text
 * after it on that line becomes the title (VitePress and Obsidian write
 * `> [!WARNING] Heads up`), and the rest of the quote is the body.
 */
const alertCallout = ({ paragraph, type }: Alert, quote: MdastNode) => {
  const [first, ...phrasing] = childrenOf(paragraph);
  const opening = String(first?.value).replace(ALERT_MARKER, "");
  const lines = splitFirstLine([{ type: "text", value: opening }, ...phrasing]);
  const title = phrasingMarkdown({ children: lines.first, type: "paragraph" });
  const attributes = [jsxAttribute("type", type)];
  if (title.trim() !== "") {
    attributes.push(jsxAttribute("title", title.trim()));
  }
  const body = lines.rest.length
    ? [{ children: lines.rest, type: "paragraph" }]
    : [];
  return jsxFlowElement("Callout", attributes, [
    ...body,
    ...childrenOf(quote).slice(1),
  ]);
};

/** Whether `node` sits inside a quote that is itself an alert. */
const insideAlert = (node: MdastNode, ctx: AlertVisitorContext): boolean => {
  for (
    let parent = ctx.parent?.(node);
    parent !== undefined;
    parent = ctx.parent?.(parent)
  ) {
    if (
      parent.type === "blockquote" &&
      alertOf(parent, ctx.source ?? "") !== undefined
    ) {
      return true;
    }
  }
  return false;
};

/**
 * Satteri MDAST plugin for GitHub alerts in `.mdx`: a quote whose first line
 * is `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, or `[!CAUTION]`
 * renders as the matching `<Callout>` (see {@link ALERT_CALLOUTS}), as on
 * GitHub. An alert quoted inside another stays a quote, as GitHub leaves it.
 * `.md` pages render no components, so their alerts stay quotes, which
 * `blume check` warns about (`core/alert-diagnostics.ts`).
 */
export const githubAlertsPlugin = () => ({
  blockquote(node: MdastNode, ctx: AlertVisitorContext) {
    const alert = alertOf(node, ctx.source ?? "");
    if (alert === undefined || insideAlert(node, ctx)) {
      return;
    }
    ctx.replaceNode(node, alertCallout(alert, node));
  },
  name: "blume-github-alerts",
  // Positions are opt-in since satteri 0.10; they tell an escaped marker
  // from a written one.
  options: { position: true },
});
