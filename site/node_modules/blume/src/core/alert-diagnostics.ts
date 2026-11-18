import type { Nodes } from "mdast";
import { markdownToMdast } from "satteri";

import { MARKDOWN_BODY_FEATURES } from "../markdown/features.ts";
import { alertMarkerOf } from "../markdown/github-alerts.ts";
import type { AlertMarker } from "../markdown/github-alerts.ts";
import { strippedLineOffset } from "./sources/normalize.ts";
import type { SourceEntry } from "./sources/types.ts";
import type { Diagnostic } from "./types.ts";

// A quote line that may open with an alert marker.
const ALERT_LINE = /^[\t >]*>[\t ]*\[![a-z]+\]/imu;

/** An alert quote in an `.md` body: its marker and the quote's line. */
interface AlertFinding extends AlertMarker {
  line: number;
}

/**
 * The GitHub alerts in an `.md` body, in source order: quotes that open with
 * `[!NOTE]` and the rest, as `markdown/github-alerts.ts` reads them in `.mdx`
 * (an escaped marker, or one quoted inside another alert, is no alert there
 * either). A page is parsed only when a line looks like one.
 */
const alertFindings = (text: string): AlertFinding[] => {
  if (!ALERT_LINE.test(text)) {
    return [];
  }
  const tree: Nodes = markdownToMdast(text, {
    features: MARKDOWN_BODY_FEATURES,
  });
  const found: AlertFinding[] = [];
  const walk = (node: Nodes): void => {
    if (node.type === "blockquote") {
      const [paragraph] = node.children;
      const first =
        paragraph?.type === "paragraph" ? paragraph.children[0] : undefined;
      const escaped = text[first?.position?.start.offset ?? 0] === "\\";
      const alert =
        first?.type === "text" && !escaped
          ? alertMarkerOf(first.value)
          : undefined;
      if (alert !== undefined) {
        found.push({ ...alert, line: node.position?.start.line ?? 1 });
        // A quote inside an alert stays a quote, alert or not.
        return;
      }
    }
    if ("children" in node) {
      for (const child of node.children) {
        walk(child);
      }
    }
  };
  walk(tree);
  return found;
};

/**
 * Warn about GitHub alerts (`> [!NOTE]`) in an `.md` entry, which renders
 * them as plain quotes that show the marker as text: alerts become callouts
 * only in `.mdx`, where Blume renders components (see
 * `markdown/github-alerts.ts`). Lines point into the file the author wrote, a
 * partial's own file for an alert an `<include>` brought in.
 */
export const alertDiagnostics = (
  entry: SourceEntry,
  sourceName: string
): Diagnostic[] => {
  if (entry.body.format !== "md") {
    return [];
  }
  const page = entry.sourcePath ?? `${sourceName}:${entry.ref}`;
  const offset =
    entry.bodyLineOffset ?? strippedLineOffset(entry.raw, entry.body.text);
  return alertFindings(entry.expanded?.text ?? entry.body.text).map(
    ({ callout, line, marker }) => {
      const origin = entry.expanded?.origins[line - 1];
      return {
        code: "BLUME_MD_GITHUB_ALERT",
        file: origin?.file ?? page,
        line: origin?.line ?? line + offset,
        message: `\`${marker}\` makes a quote a callout only in .mdx; in this .md page it renders as a quote that shows \`${marker}\` as text.`,
        severity: "warning",
        suggestion: `Rename the page to .mdx to render it as a \`${callout}\` callout, or remove \`${marker}\` to keep a plain quote.`,
      };
    }
  );
};
