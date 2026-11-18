/**
 * RFC 9457 problem details — the one error shape every Blume JSON endpoint
 * returns, so an agent that hits a missing page, a bad query, or an unknown
 * API route always gets a stable machine-readable `code`, a human-readable
 * `detail`, and a `resolution` telling it where to go next.
 */

export const PROBLEM_TYPE = "application/problem+json";

/** A recovery link carried on a problem (the 404's "where to look next"). */
export interface ProblemLink {
  href: string;
  label: string;
}

export interface Problem {
  /** Stable, screaming-snake error code for programmatic handling. */
  code: string;
  /** Human-readable explanation specific to this occurrence. */
  detail: string;
  /** The request path the problem occurred on, when known. */
  instance?: string;
  /** Recovery links, when the problem has somewhere useful to send the caller. */
  links?: ProblemLink[];
  /** What to do next — the hint agents act on. */
  resolution: string;
  status: number;
  title: string;
  /** Problem type URI; `about:blank` when the status code says it all. */
  type: string;
}

/** The problem's members, with `type` defaulting to `about:blank`. */
export const problem = (
  input: Omit<Problem, "type"> & { type?: string }
): Problem => {
  const body: Problem = {
    code: input.code,
    detail: input.detail,
    resolution: input.resolution,
    status: input.status,
    title: input.title,
    type: input.type ?? "about:blank",
  };
  if (input.instance !== undefined) {
    body.instance = input.instance;
  }
  if (input.links !== undefined) {
    body.links = input.links;
  }
  return body;
};

/** A `Response` carrying the problem as `application/problem+json`. */
export const problemResponse = (
  input: Omit<Problem, "type"> & { type?: string }
): Response => {
  const body = problem(input);
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    headers: { "Content-Type": `${PROBLEM_TYPE}; charset=utf-8` },
    status: body.status,
  });
};
