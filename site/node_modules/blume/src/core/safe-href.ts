/**
 * Link destinations in content Blume imports from someone else — an API spec's
 * descriptions, a repository's release notes, CMS rich text — that are safe to
 * render as a clickable link. Author-written pages are trusted and never pass
 * through here; imported content can carry a `javascript:` (or `data:`,
 * `vbscript:`) link that would run as the docs site when a reader clicks it.
 * A destination with no scheme (a relative path, a fragment) stays a link, as
 * does one whose scheme is on this list.
 */
const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

const SCHEME = /^(?<scheme>[a-z][\d+.a-z-]*):/iu;

// Markdown decodes a destination before the browser sees it: a backslash
// escape (`javascript\:`) and a character reference (`java&#115;cript:`,
// `javascript&colon;`) both reach the `href` as the plain character, so the
// check reads the destination decoded. Of HTML's named references, these are
// the only ones that decode to a scheme character, a colon, or a character
// the URL parser strips; every other one leaves the scheme a browser reads
// unchanged.
const MARKDOWN_DECODED =
  /\\(?<escaped>[!-/:-@[-`{-~])|&(?:#[Xx](?<hex>[\dA-Fa-f]{1,6})|#(?<decimal>\d{1,7})|(?<named>colon|fjlig|NewLine|period|plus|Tab));/gu;

const NAMED_REFERENCES = new Map([
  ["colon", ":"],
  ["fjlig", "fj"],
  ["NewLine", "\n"],
  ["period", "."],
  ["plus", "+"],
  ["Tab", "\t"],
]);

const MAX_CODE_POINT = 0x10_ff_ff;
const SURROGATES = { end: 0xdf_ff, start: 0xd8_00 };

/** A numeric reference's character; U+FFFD for NUL, surrogates, and overflow. */
const fromReference = (code: number): string =>
  code === 0 ||
  code > MAX_CODE_POINT ||
  (code >= SURROGATES.start && code <= SURROGATES.end)
    ? "�"
    : String.fromCodePoint(code);

const decodeMarkdown = (href: string): string =>
  href.replaceAll(
    MARKDOWN_DECODED,
    (
      _match: string,
      escaped?: string,
      hex?: string,
      decimal?: string,
      named?: string
    ) => {
      if (escaped !== undefined) {
        return escaped;
      }
      if (named !== undefined) {
        return NAMED_REFERENCES.get(named) ?? "";
      }
      const code =
        hex === undefined ? Number(decimal) : Number.parseInt(hex, 16);
      return fromReference(code);
    }
  );

// The URL parser removes ASCII tabs and newlines anywhere, and strips leading
// C0 controls and spaces, before it reads a scheme — so `java\tscript:` is a
// `javascript:` URL to a browser, and the check must see it the same way.
const URL_IGNORED = /[\t\n\r]/gu;

/** Whether a link destination from imported content is safe to keep. */
export const isSafeHref = (href: string): boolean => {
  const cleaned = decodeMarkdown(href).replaceAll(URL_IGNORED, "");
  let start = 0;
  while (start < cleaned.length && (cleaned.codePointAt(start) ?? 0) <= 0x20) {
    start += 1;
  }
  const scheme = SCHEME.exec(cleaned.slice(start))?.groups?.scheme;
  return scheme === undefined || SAFE_SCHEMES.has(scheme.toLowerCase());
};
