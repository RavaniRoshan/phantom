/**
 * The assistant's handoff to your support channel (`ai.assistant.support`).
 * A `mailto:` link starts an email with the conversation as its body, so the
 * reader doesn't have to repeat themselves; any other link gets the
 * conversation's `thread` id in its query, the same id the assistant's
 * analytics events carry, so a support team can find the conversation.
 */

/** One turn of the conversation. */
export interface SupportMessage {
  content: string;
  role: "assistant" | "user";
}

/** What the link is built from. */
export interface SupportContext {
  /** The label the transcript gives the assistant's turns. */
  ai: string;
  messages: readonly SupportMessage[];
  /** The email's subject. */
  subject: string;
  thread: string;
  /** The label the transcript gives the reader's turns. */
  you: string;
}

/**
 * How much conversation an email carries: mail clients cut long `mailto:`
 * links, so a long conversation is trimmed from the start, keeping the
 * latest turns.
 */
export const MAX_TRANSCRIPT_CHARS = 1500;

const transcriptOf = (context: SupportContext): string => {
  const full = context.messages
    .map(
      (message) =>
        `${message.role === "user" ? context.you : context.ai}: ${message.content}`
    )
    .join("\n\n");
  return full.length > MAX_TRANSCRIPT_CHARS
    ? `…${full.slice(-MAX_TRANSCRIPT_CHARS)}`
    : full;
};

/** The support link for this conversation. */
export const supportHref = (
  support: string,
  context: SupportContext
): string => {
  if (support.startsWith("mailto:")) {
    // `mailto:` wants %20, not the `+` URLSearchParams writes for a space.
    const body = `${transcriptOf(context)}\n\n(${context.thread})`;
    const separator = support.includes("?") ? "&" : "?";
    return `${support}${separator}subject=${encodeURIComponent(context.subject)}&body=${encodeURIComponent(body)}`;
  }
  const url = new URL(support, "https://blume.invalid");
  url.searchParams.set("thread", context.thread);
  return url.origin === "https://blume.invalid"
    ? `${url.pathname}${url.search}${url.hash}`
    : url.href;
};

/** A fresh conversation id: 16 hex characters. */
export const newThreadId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
