/**
 * Where the JSON docs API and its OpenAPI description are served. Base-less
 * (like every route Blume emits); callers layer `deployment.base` on top.
 * Under `/api/` alongside the assistant endpoint (`/api/ask`) so the namespace a
 * Blume site reserves for live endpoints stays one prefix, and under its own
 * `docs` segment so a search provider's proxy at `/api/search` never collides.
 */

export const OPENAPI_PATH = "/openapi.json";
export const API_BASE = "/api/docs";
export const API_PAGES_PATH = `${API_BASE}/pages.json`;
export const API_PAGE_PATH = `${API_BASE}/pages/{route}.json`;
export const API_NAVIGATION_PATH = `${API_BASE}/navigation.json`;
export const API_SEARCH_PATH = `${API_BASE}/search`;

/** The `pages/{route}.json` path segment for a route (`index` for home). */
export const pageParam = (route: string): string =>
  route === "/" ? "index" : route.slice(1);

/** The base-less served path of a route's per-page JSON document. */
export const pageJsonPath = (route: string): string =>
  `${API_BASE}/pages/${pageParam(route)}.json`;
