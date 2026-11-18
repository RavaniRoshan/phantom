import { nextFenceState } from "../core/code-fences.ts";
import type { FenceState } from "../core/code-fences.ts";

/** An inline code span on one line, as the other source scanners read it. */
const INLINE_CODE = /`[^`\n]*`/gu;
// NUL delimiters cannot appear in authored markdown, so tokens never collide.
// oxlint-disable-next-line no-control-regex -- the NUL is the collision guard.
const CODE_TOKEN = /\u0000blume-code-(?<index>\d+)\u0000/gu;

/**
 * Swap every code sample for a one-line token — fenced blocks at any indent
 * (a fence inside a `<Tab>` or `<Step>` is indented under it) and inline code
 * spans — so markup that *shows* `<Visibility>` keeps showing what the author
 * wrote. An unclosed fence runs to the end, as CommonMark reads it.
 */
const maskCode = (markdown: string, stash: string[]): string => {
  const token = (code: string): string => {
    stash.push(code);
    return `\u0000blume-code-${stash.length - 1}\u0000`;
  };
  const lines: string[] = [];
  let fence: FenceState = null;
  let block: string[] = [];
  for (const line of markdown.split("\n")) {
    const next = nextFenceState(line, fence);
    if (fence === null && next === null) {
      lines.push(line.replaceAll(INLINE_CODE, token));
    } else {
      block.push(line);
      if (next === null) {
        lines.push(token(block.join("\n")));
        block = [];
      }
    }
    fence = next;
  }
  if (block.length > 0) {
    lines.push(token(block.join("\n")));
  }
  return lines.join("\n");
};

/** The audience an output surface serves — the component's two `for` values. */
export type VisibilityAudience = "agents" | "web";

// `<Visibility for="…">…</Visibility>` in either quote style, tolerant of
// whitespace around the attribute and inside the tags. Non-greedy bodies stop
// at the first close tag, so nesting is not supported: a nested block closes
// the outer match early and any remainder passes through verbatim.
const visibilityBlock = (audience: VisibilityAudience): RegExp =>
  new RegExp(
    `<Visibility\\s+for\\s*=\\s*(?:"${audience}"|'${audience}')\\s*>(?<inner>[\\s\\S]*?)</Visibility\\s*>`,
    "gu"
  );

const BLOCKS = {
  agents: visibilityBlock("agents"),
  web: visibilityBlock("web"),
} satisfies Record<VisibilityAudience, RegExp>;

/**
 * Resolve `<Visibility>` blocks for one audience: blocks addressed to the
 * other audience are removed entirely and blocks addressed to `audience` are
 * unwrapped (tags dropped, body kept), matching what the Astro component
 * renders on the web. Other `for` values (the component's default) are left
 * untouched, and markdown with no matching blocks is returned byte-identical,
 * so raw sources stay raw.
 */
export const applyAudienceVisibility = (
  markdown: string,
  audience: VisibilityAudience
): string => {
  // Mask code so documentation *about* Visibility survives.
  const code: string[] = [];
  const masked = maskCode(markdown, code);

  let touched = false;
  const filtered = masked
    .replaceAll(BLOCKS[audience === "agents" ? "web" : "agents"], () => {
      touched = true;
      return "";
    })
    .replaceAll(BLOCKS[audience], (_match, inner: string) => {
      touched = true;
      return inner;
    });

  // Removing/unwrapping block-level tags leaves runs of blank lines behind;
  // collapse them only when something matched so untouched files round-trip
  // exactly. Code is masked as single-line tokens, so it is unaffected.
  const tidied = touched ? filtered.replaceAll(/\n{3,}/gu, "\n\n") : filtered;

  return tidied.replaceAll(
    CODE_TOKEN,
    (token, index) => code[Number(index)] ?? token
  );
};

/**
 * Resolve `<Visibility>` blocks for agent-facing Markdown (llms-full.txt, the
 * `.md`/`.mdx` mirrors, MCP tools, assistant grounding): `for="web"` content is
 * removed and `for="agents"` content is unwrapped.
 */
export const applyAgentVisibility = (markdown: string): string =>
  applyAudienceVisibility(markdown, "agents");
