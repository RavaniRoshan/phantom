import type { MiddlewareHandler } from "astro";

import { iconSpriteFor, renderIconSprite } from "./icon-sprite.ts";
import type { IconSprite } from "./icon-sprite.ts";

/**
 * The placeholder a shell renders where its icon sprite goes (the end of the
 * body); {@link onRequest} replaces it once the page has fully rendered.
 * Rendering the sprite from a component instead wouldn't work: Astro walks a
 * template's own markup before its nested components render, so a sprite
 * component at the end of the body runs before the header's search button or
 * the page content's callouts have registered their icons.
 */
export const ICON_SPRITE_SLOT = "<!--blume-icon-sprite-->";

/** The page HTML with its placeholder replaced by the finished sprite. */
export const spliceIconSprite = (html: string, sprite?: IconSprite): string =>
  html.includes(ICON_SPRITE_SLOT)
    ? html.replace(ICON_SPRITE_SLOT, sprite ? renderIconSprite(sprite) : "")
    : html;

/**
 * Blume's icon-sprite middleware (wired by the integration). Draining the
 * response renders the whole page, after which the request's registry holds
 * every icon it used; the sprite is spliced in where the shell left the slot.
 * Requests whose shell kept no registry — a user layout override, a partial,
 * an endpoint — pass through untouched, streaming and all.
 */
export const onRequest: MiddlewareHandler = async (context, render) => {
  const response = await render();
  const sprite = iconSpriteFor(context.locals);
  if (!sprite) {
    return response;
  }
  const html = await response.text();
  return new Response(spliceIconSprite(html, sprite), {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
};
