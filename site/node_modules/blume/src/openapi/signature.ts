import { graphqlSignature } from "./graphql.ts";
import type { ApiOperationRef, ApiSpecData } from "./model.ts";

/**
 * The one-line name of what an operation page documents, in the notation of
 * its spec kind: `GET /pets/{id}` for an HTTP endpoint, `SEND user/signup`
 * for an AsyncAPI channel action, `query pets` or `type Pet` for a GraphQL
 * member. The page titles an untitled operation with it and the agent
 * surfaces (`<route>.md`, llms-full.txt, MCP `get_page`) downlevel
 * `<Operation>` to it, so the two can never disagree about the endpoint.
 */
export const operationSignature = (
  spec: Pick<ApiSpecData, "kind">,
  operation: Pick<ApiOperationRef, "method" | "path">
): string =>
  spec.kind === "graphql"
    ? graphqlSignature(operation)
    : `${operation.method.toUpperCase()} ${operation.path}`;
