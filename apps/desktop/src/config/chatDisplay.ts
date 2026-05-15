/**
 * chatDisplay — shared display thresholds for chat / replay UI.
 *
 * Centralises magic numbers used across replay rendering. Follows the
 * `TOOLS_COLLAPSE_LIMIT` precedent in `composables/useConfigInjector.ts`.
 */

/** Max tool calls shown in a replay-step section before requiring "Show more". */
export const MAX_VISIBLE_TOOLS = 8;

/** Max characters in an assistant message bubble before truncation. */
export const MAX_MESSAGE_CHARS = 3000;
