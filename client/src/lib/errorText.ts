// Turns an error thrown by apiRequest/throwIfResNotOk (shape: `${status}: ${body}`)
// into text that is safe and readable in a toast. Display only: it never changes
// what is thrown. Pure and dependency-free so a Node unit test can import it.

const STATUS_PREFIX = /^\d{3}: /;
const MAX_PLAIN_LENGTH = 200;

function shortPlainText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.includes("<")) return null;
  if (trimmed.length > MAX_PLAIN_LENGTH) return null;
  return trimmed;
}

export function friendlyErrorText(input: unknown, fallback = "Something went wrong, please try again"): string {
  try {
    let text: string;
    if (input instanceof Error) {
      text = input.message;
    } else if (typeof input === "string") {
      text = input;
    } else {
      return fallback;
    }
    if (typeof text !== "string") return fallback;

    if (!STATUS_PREFIX.test(text)) {
      return shortPlainText(text) ?? fallback;
    }

    const rest = text.replace(STATUS_PREFIX, "");
    let parsed: unknown;
    let isJson = false;
    try {
      parsed = JSON.parse(rest);
      isJson = true;
    } catch {
      isJson = false;
    }

    if (isJson) {
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const message = (parsed as { message?: unknown }).message;
        if (typeof message === "string" && message.trim().length > 0) {
          return message.trim();
        }
      }
      return fallback;
    }

    return shortPlainText(rest) ?? fallback;
  } catch {
    return fallback;
  }
}
