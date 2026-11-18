/**
 * Helpers for the `<YouTube>` content component. Kept in a sibling `.ts` (like
 * `diff.ts`/`github-info.ts`) so the id parsing and embed-URL building are pure,
 * unit-testable functions — the `.astro` file stays a thin presentational shell.
 */

// A YouTube video id is 11 characters of [A-Za-z0-9_-].
const BARE_ID = /^[\w-]{11}$/u;

// Pull the id out of any common YouTube URL: youtu.be/<id>, watch?v=<id>,
// /embed/<id>, /shorts/<id>, /live/<id>. A playlist embed's
// `/embed/videoseries` is 11 characters too, but it names no video.
const URL_ID =
  /(?:youtu\.be\/|\/embed\/(?!videoseries\b)|\/shorts\/|\/live\/|[?&]v=)(?<id>[\w-]{11})/u;

// A playlist URL: the embed form, `/embed/videoseries?list=<id>`, or the
// playlist page, `/playlist?list=<id>`.
const PLAYLIST =
  /\/(?:embed\/videoseries|playlist)\?(?:[^#]*&)?list=(?<list>[\w-]+)/u;

/**
 * Resolve a YouTube video id from either a bare id or a full URL. Returns `null`
 * when nothing that looks like an id can be found, so the component can render
 * nothing rather than a broken embed.
 */
export const parseYouTubeId = (input: string): string | null => {
  const value = input.trim();
  if (!value) {
    return null;
  }
  if (BARE_ID.test(value)) {
    return value;
  }
  return URL_ID.exec(value)?.groups?.id ?? null;
};

/**
 * The playlist id of a YouTube playlist URL (`/embed/videoseries?list=…` or
 * `/playlist?list=…`), or `null` for anything else — a video URL that also
 * carries a `list` (`watch?v=…&list=…`) is that video.
 */
export const parseYouTubePlaylist = (input: string): string | null =>
  PLAYLIST.exec(input.trim())?.groups?.list ?? null;

/** The query a `start` time adds to an embed URL, or nothing. */
const startParam = (start: number | undefined): Record<string, string> =>
  start && start > 0 ? { start: String(Math.floor(start)) } : {};

/**
 * Build a privacy-enhanced (`youtube-nocookie.com`) embed URL, optionally
 * starting at `start` seconds.
 */
export const youtubeEmbedUrl = (
  id: string,
  options: { start?: number } = {}
): string => {
  const base = `https://www.youtube-nocookie.com/embed/${id}`;
  const params = new URLSearchParams(startParam(options.start));
  return params.size > 0 ? `${base}?${params.toString()}` : base;
};

/**
 * The privacy-enhanced embed URL for a playlist, optionally starting its
 * first video at `start` seconds.
 */
export const youtubePlaylistEmbedUrl = (
  list: string,
  options: { start?: number } = {}
): string => {
  const params = new URLSearchParams({ list, ...startParam(options.start) });
  return `https://www.youtube-nocookie.com/embed/videoseries?${params.toString()}`;
};

/**
 * The embed URL for a `<YouTube>`'s `id` or `url`: a video, else a playlist,
 * else `null` when the input names neither.
 */
export const youtubeEmbedSrc = (
  input: string,
  options: { start?: number } = {}
): string | null => {
  const id = parseYouTubeId(input);
  if (id) {
    return youtubeEmbedUrl(id, options);
  }
  const list = parseYouTubePlaylist(input);
  return list ? youtubePlaylistEmbedUrl(list, options) : null;
};
