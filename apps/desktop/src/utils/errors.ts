/**
 * Normalize any caught error-like value into a human-readable message.
 * Falls back to a caller-supplied default when no useful text is available.
 */
export function toErrorMessage(error: unknown, fallback = "Unexpected error"): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  try {
    const text = String(error);
    if (text && text !== "[object Object]") {
      return text;
    }
  } catch {
    // ignore — fall back below
  }

  return fallback;
}
