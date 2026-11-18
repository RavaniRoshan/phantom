/** The slice of Astro's `APIContext` a server route reads the reader from. */
export interface ClientContext {
  /** The reader's address; Astro's getter throws where the host can't tell. */
  readonly clientAddress?: string;
  readonly request: Request;
}

/**
 * The reader's IP address as the host reports it (Astro resolves the
 * platform's trusted header, or the socket on a Node server), or `undefined`
 * where the host can't tell.
 */
export const clientAddressOf = (context: ClientContext): string | undefined => {
  try {
    return context.clientAddress || undefined;
  } catch {
    return undefined;
  }
};
