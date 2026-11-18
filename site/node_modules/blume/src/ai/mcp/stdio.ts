import { once } from "node:events";
import type { Readable, Writable } from "node:stream";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { McpData } from "./data.ts";
import { buildServer, createIndexProvider } from "./server.ts";

/** Streams for `serveMcpStdio`, injectable so tests can use in-memory pipes. */
export interface McpStdioStreams {
  stdin?: Readable;
  stdout?: Writable;
}

/**
 * Serve a precomputed MCP data snapshot over a stdio transport until the
 * client hangs up.
 *
 * The SDK transport reads its input stream but never watches for its end, so
 * a client that simply closes the pipe — which is how every MCP host shuts a
 * stdio server down — would leave the process running forever. EOF on the
 * input stream therefore ends the serve loop explicitly.
 */
export const serveMcpStdio = async (
  data: McpData,
  streams: McpStdioStreams = {}
): Promise<void> => {
  const stdin = streams.stdin ?? process.stdin;
  const stdout = streams.stdout ?? process.stdout;
  const transport = new StdioServerTransport(stdin, stdout);
  const server = buildServer(
    data,
    createIndexProvider(data.documents, data.defaultLocale)
  );
  await server.connect(transport);
  await once(stdin, "end");
  await transport.close();
};
