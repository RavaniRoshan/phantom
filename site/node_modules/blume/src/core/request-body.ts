/**
 * Read a request body under a size cap, for the unauthenticated endpoints a
 * server build exposes (the assistant route, the API playground proxy). A
 * self-hosted Node server buffers whatever a client sends, so an endpoint that
 * starts with `request.json()` or `arrayBuffer()` lets one oversized POST
 * allocate hundreds of megabytes before any validation runs. A declared
 * `content-length` over the cap is refused without reading the body; a body
 * sent without one (chunked) is read until it passes the cap, then cancelled.
 *
 * Resolves to the bytes, or `undefined` when the body is over the cap — the
 * caller answers that with a `413`.
 */
export const readCappedBody = async (
  request: Request,
  maxBytes: number
): Promise<Uint8Array<ArrayBuffer> | undefined> => {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) {
    return undefined;
  }
  if (!request.body) {
    return new Uint8Array(0);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let over = false;
  while (!over) {
    // oxlint-disable-next-line no-await-in-loop -- a stream yields its chunks one read at a time, in order
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    over = size > maxBytes;
    chunks.push(value);
  }
  if (over) {
    await reader.cancel();
    return undefined;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

/**
 * The body as UTF-8 text under the same cap as {@link readCappedBody}, or
 * `undefined` when it's over the cap.
 */
export const readCappedText = async (
  request: Request,
  maxBytes: number
): Promise<string | undefined> => {
  const bytes = await readCappedBody(request, maxBytes);
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
};
