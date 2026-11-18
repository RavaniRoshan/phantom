import { NodeType, parse } from "node-html-parser";
import type { HTMLElement, Node } from "node-html-parser";

/**
 * A `<Prompt>`'s body as Markdown, for its copy button and "Open in Cursor"
 * link. The component only ever sees its slot as rendered HTML, so this turns
 * that HTML back into the Markdown a reader pastes into an AI tool — keeping
 * link URLs, list markers, emphasis, and code fences that the element's plain
 * `textContent` would drop.
 */

/** Elements that carry no prompt text: chrome, media, and hidden content. */
const SKIPPED = new Set(["BUTTON", "SCRIPT", "STYLE", "SVG", "TEMPLATE"]);

const HEADING = /^H(?<level>[1-6])$/u;

/** Elements that start a block of their own rather than flowing inline. */
const BLOCKS = new Set([
  "BLOCKQUOTE",
  "DETAILS",
  "DIV",
  "FIGURE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HR",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "UL",
]);

const isElement = (node: Node): node is HTMLElement =>
  node.nodeType === NodeType.ELEMENT_NODE;

const isSkipped = (element: HTMLElement): boolean =>
  SKIPPED.has(element.tagName) ||
  element.hasAttribute("hidden") ||
  element.getAttribute("aria-hidden") === "true";

/** A backtick run one longer than any inside `text`, so it can't close early. */
const fenceFor = (text: string, minimum: number): string => {
  const longest = Math.max(
    0,
    ...(text.match(/`+/gu) ?? []).map((run) => run.length)
  );
  return "`".repeat(Math.max(minimum, longest + 1));
};

/** Wrap `inner` in `marker`, keeping edge spaces outside the markers. */
const wrap = (marker: string, inner: string): string => {
  const trimmed = inner.trim();
  if (!trimmed) {
    return inner;
  }
  const lead = inner.startsWith(" ") ? " " : "";
  const trail = inner.endsWith(" ") ? " " : "";
  return `${lead}${marker}${trimmed}${marker}${trail}`;
};

const inlineCode = (text: string): string => {
  const fence = fenceFor(text, 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
};

/**
 * Finish an inline run: HTML collapses whitespace across element edges too, so
 * the space a text node and an emphasis marker each kept becomes one.
 */
const collapse = (text: string): string =>
  text.replaceAll(/ {2,}/gu, " ").trim();

const inline = (node: Node): string => {
  if (!isElement(node)) {
    // HTML collapses runs of whitespace (source newlines included) to one space.
    return node.text.replaceAll(/\s+/gu, " ");
  }
  if (isSkipped(node)) {
    return "";
  }
  const children = () => node.childNodes.map(inline).join("");
  switch (node.tagName) {
    case "A": {
      const href = node.getAttribute("href");
      const label = children().trim();
      if (!href) {
        return label;
      }
      return label && label !== href ? `[${label}](${href})` : href;
    }
    case "B":
    case "STRONG": {
      return wrap("**", children());
    }
    case "BR": {
      return "\n";
    }
    case "CODE": {
      return inlineCode(node.text);
    }
    case "DEL":
    case "S": {
      return wrap("~~", children());
    }
    case "EM":
    case "I": {
      return wrap("_", children());
    }
    case "IMG": {
      const src = node.getAttribute("src");
      return src ? `![${node.getAttribute("alt") ?? ""}](${src})` : "";
    }
    default: {
      return children();
    }
  }
};

/** A line-by-line indent, leaving blank lines blank. */
const indent = (text: string, prefix: string): string =>
  text
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : line))
    .join("\n");

const codeBlock = (pre: HTMLElement): string => {
  const code = pre.querySelector("code");
  const language =
    pre.attributes["data-language"] ??
    /\blanguage-(?<lang>\S+)/u.exec(code?.getAttribute("class") ?? "")?.groups
      ?.lang ??
    "";
  const text = (code ?? pre).text.replace(/\n$/u, "");
  const fence = fenceFor(text, 3);
  return `${fence}${language}\n${text}\n${fence}`;
};

const listBlock = (list: HTMLElement): string => {
  const ordered = list.tagName === "OL";
  let number = Number(list.getAttribute("start") ?? "1") || 1;
  const items: string[] = [];
  for (const item of list.childNodes) {
    if (!isElement(item) || item.tagName !== "LI") {
      continue;
    }
    const marker = ordered ? `${number}.` : "-";
    number += 1;
    // A tight item (no paragraphs of its own) keeps its nested list on the
    // next line; a loose one separates its blocks with a blank line.
    const loose = item.childNodes.some(
      (child) => isElement(child) && child.tagName === "P"
    );
    // oxlint-disable-next-line no-use-before-define -- mutual recursion: an item holds blocks, including nested lists
    const body = blocks(item).join(loose ? "\n\n" : "\n");
    const [first = "", ...rest] = body.split("\n");
    const continuation = indent(rest.join("\n"), " ".repeat(marker.length + 1));
    items.push(
      continuation
        ? `${marker} ${first}\n${continuation}`
        : `${marker} ${first}`
    );
  }
  return items.join("\n");
};

/** A GFM delimiter cell per column alignment; unaligned columns get `---`. */
const DELIMITERS = new Map([
  ["center", ":---:"],
  ["left", ":---"],
  ["right", "---:"],
]);

const TEXT_ALIGN = /text-align:\s*(?<align>center|left|right)/u;

/** A cell's alignment, from the `align` attribute or an inline style. */
const cellAlign = (cell: HTMLElement | undefined): string =>
  cell?.getAttribute("align") ??
  TEXT_ALIGN.exec(cell?.getAttribute("style") ?? "")?.groups?.align ??
  "";

/** A cell's inline Markdown on one line, its pipes escaped. */
const tableCell = (cell: HTMLElement | undefined): string =>
  cell
    ? collapse(inline(cell).replaceAll("\n", " ")).replaceAll(
        "|",
        String.raw`\|`
      )
    : "";

const isCell = (node: Node): node is HTMLElement =>
  isElement(node) && (node.tagName === "TD" || node.tagName === "TH");

/**
 * A table as a GFM table: its first row as the header (GFM requires one), a
 * delimiter row carrying each column's alignment, then the body rows, padded
 * to the widest row.
 */
const tableBlock = (table: HTMLElement): string => {
  const rows = table
    .querySelectorAll("tr")
    .filter((row) => !isSkipped(row))
    .map((row) => row.childNodes.filter(isCell));
  const [head, ...body] = rows;
  if (!head) {
    return "";
  }
  const width = Math.max(...rows.map((row) => row.length));
  const columns = Array.from({ length: width }, (_, index) => index);
  const row = (cells: HTMLElement[]): string =>
    `| ${columns.map((index) => tableCell(cells[index])).join(" | ")} |`;
  const delimiter = `| ${columns
    .map((index) => DELIMITERS.get(cellAlign(head[index])) ?? "---")
    .join(" | ")} |`;
  return [row(head), delimiter, ...body.map(row)].join("\n");
};

const block = (element: HTMLElement): string[] => {
  const heading = HEADING.exec(element.tagName)?.groups?.level;
  if (heading) {
    return [`${"#".repeat(Number(heading))} ${collapse(inline(element))}`];
  }
  switch (element.tagName) {
    case "BLOCKQUOTE": {
      // Every line is quoted, blank ones included, so the paragraphs stay in
      // one quote.
      // oxlint-disable-next-line no-use-before-define -- mutual recursion: a quote holds blocks
      const quoted = blocks(element)
        .join("\n\n")
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"));
      return [quoted.join("\n")];
    }
    case "HR": {
      return ["---"];
    }
    case "OL":
    case "UL": {
      return [listBlock(element)];
    }
    case "P": {
      return [collapse(inline(element))];
    }
    case "PRE": {
      return [codeBlock(element)];
    }
    case "TABLE": {
      return [tableBlock(element)];
    }
    default: {
      // oxlint-disable-next-line no-use-before-define -- mutual recursion: a container holds blocks
      return blocks(element);
    }
  }
};

/** A container's children as Markdown blocks, inline runs grouped into one. */
const blocks = (container: HTMLElement): string[] => {
  const out: string[] = [];
  let run = "";
  const flush = () => {
    const text = collapse(run);
    if (text) {
      out.push(text);
    }
    run = "";
  };
  for (const child of container.childNodes) {
    if (isElement(child) && BLOCKS.has(child.tagName)) {
      flush();
      if (!isSkipped(child)) {
        out.push(...block(child).filter(Boolean));
      }
    } else {
      run += inline(child);
    }
  }
  flush();
  return out;
};

export const promptMarkdown = (html: string): string =>
  // `pre` is parsed as elements (not raw text) so a code block's `<code>` and
  // its language attribute are reachable.
  blocks(parse(html, { blockTextElements: { script: true, style: true } }))
    .join("\n\n")
    .trim();
