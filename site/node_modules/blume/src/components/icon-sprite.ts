/**
 * A per-page SVG sprite for the icon sets. A page renders the same handful of
 * icons many times over (every sidebar chevron, every code-block language
 * icon, the page-action buttons); inlining each one repeats its paths on every
 * use, which on a docs page is ~20 kB of the ~60 kB that isn't the sidebar.
 * With the sprite, each use is a `<use href="#…">` reference and the paths
 * appear once, in a hidden `<svg>` the layout renders at the end of the body.
 *
 * The registry lives on the request's `Astro.locals`, so every component in
 * one page render — the layout, the MDX content, cached sidebar subtrees —
 * shares it, and concurrent page renders never see each other's icons. A
 * shell that creates no registry (a user's layout override, a partial) gets
 * inline icons, exactly as before.
 */

/** One symbol in the sprite: an icon set's inner markup and its viewBox. */
export interface IconSymbol {
  body: string;
  viewBox: string;
}

export interface IconSprite {
  /** Symbol id → symbol, in first-use order. */
  symbols: Map<string, IconSymbol>;
}

/** The request locals (`Astro.locals`) slot the registry lives in. */
export interface IconSpriteLocals {
  blumeIconSprite?: IconSprite;
}

/** The request's sprite registry, when a shell created one. */
export const iconSpriteFor = (
  locals: IconSpriteLocals
): IconSprite | undefined => locals.blumeIconSprite;

/**
 * The request's sprite registry, created on first call: a shell calls this
 * up front. Idempotent, so a shell rendered inside another shell's request
 * joins the existing registry instead of discarding its icons.
 */
export const createIconSprite = (locals: IconSpriteLocals): IconSprite => {
  locals.blumeIconSprite ??= { symbols: new Map() };
  return locals.blumeIconSprite;
};

/**
 * The sprite symbol id for an icon name. Names come from config and content
 * (`lucide:arrow-right`, `simple-icons:github`), so anything outside the id
 * charset is folded to a dash.
 */
export const iconSymbolId = (name: string): string =>
  `blume-i-${name.toLowerCase().replaceAll(/[^a-z0-9-]+/gu, "-")}`;

/** Register a symbol (idempotent) and return its id. */
export const registerIconSymbol = (
  sprite: IconSprite,
  name: string,
  symbol: IconSymbol
): string => {
  const id = iconSymbolId(name);
  if (!sprite.symbols.has(id)) {
    sprite.symbols.set(id, symbol);
  }
  return id;
};

/** The ids of every sprite symbol a rendered HTML fragment references. */
export const referencedIconSymbols = (html: string): string[] => [
  ...new Set(
    [...html.matchAll(/href="#(?<id>blume-i-[^"]+)"/gu)].map(
      (match) => match.groups?.id ?? ""
    )
  ),
];

/**
 * The hidden sprite `<svg>` holding every registered symbol, or an empty
 * string when the page used no set icon. Symbol bodies are the icon sets'
 * own markup (already SVG); the viewBox is the only attribute interpolated.
 */
export const renderIconSprite = (sprite: IconSprite): string => {
  if (sprite.symbols.size === 0) {
    return "";
  }
  const symbols = [...sprite.symbols]
    .map(
      ([id, symbol]) =>
        `<symbol id="${id}" viewBox="${symbol.viewBox}">${symbol.body}</symbol>`
    )
    .join("");
  return `<svg aria-hidden="true" hidden xmlns="http://www.w3.org/2000/svg">${symbols}</svg>`;
};
