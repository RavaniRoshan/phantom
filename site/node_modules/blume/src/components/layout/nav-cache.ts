import type { NavNode } from "../../core/types.ts";
import type { IconSymbol } from "../icon-sprite.ts";

/**
 * Build-time cache of rendered sidebar subtrees. A group that does not contain
 * the current page renders identically on every page (no `aria-current`, no
 * forced-open ancestor), so its HTML is rendered once and reused across the
 * build — keyed on the group node's identity (a regenerated navigation is a
 * new object, so a stale tree is never served) and the render variant (the
 * panel id prefix and localized labels). The in-flight promise is what's
 * stored, so concurrent page renders share one render of the same subtree.
 */
/** A cached subtree: its HTML and the sprite symbols that HTML references. */
export interface CachedNavSubtree {
  html: string;
  /** Symbol id → symbol, so a later page can register them into its sprite. */
  icons: [string, IconSymbol][];
}

const cache = new WeakMap<NavNode, Map<string, Promise<CachedNavSubtree>>>();

/**
 * The cached subtree of `node` for `variant` — its HTML plus the icon sprite
 * symbols it references, since the HTML is reused on pages that never
 * rendered those icons themselves — rendering it with `render` on the first
 * request. `enabled: false` always renders (the dev
 * server, where an edited component must show its change on the next request).
 */
export const cachedNavSubtree = (
  node: NavNode,
  variant: string,
  render: () => Promise<CachedNavSubtree>,
  enabled = true
): Promise<CachedNavSubtree> => {
  if (!enabled) {
    return render();
  }
  let byVariant = cache.get(node);
  if (!byVariant) {
    byVariant = new Map();
    cache.set(node, byVariant);
  }
  let html = byVariant.get(variant);
  if (!html) {
    html = render();
    byVariant.set(variant, html);
  }
  return html;
};
