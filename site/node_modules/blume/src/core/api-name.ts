/**
 * Whether a name already reads as an API's name: it contains `API` or `APIs`
 * as a whole word, anywhere. Word-bounded on both sides, so "OpenAPI" and
 * "AsyncAPI" are product names rather than API names and still take the
 * suffix; unanchored at the end, so "Petstore API v2" is left alone too.
 */
const NAMES_AN_API = /\bAPIs?\b/iu;

/**
 * `name` as the phrase "the ___" in generated prose — the spec title or
 * reference label, followed by ` API` unless it already says so. Keeps
 * "Petstore" reading as "Petstore API" without turning "Petstore API" into
 * "Petstore API API".
 */
export const apiNamePhrase = (name: string): string => {
  const trimmed = name.trim();
  return NAMES_AN_API.test(trimmed) ? trimmed : `${trimmed} API`;
};
