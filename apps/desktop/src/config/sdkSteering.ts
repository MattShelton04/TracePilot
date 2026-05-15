/**
 * sdkSteering — display / behavior constants for the SDK steering composable.
 *
 * Extracted from the steering composable to keep magic numbers in one place,
 * matching the `TOOLS_COLLAPSE_LIMIT` precedent in `composables/useConfigInjector.ts`.
 */

/** Maximum number of recently-sent prompts kept in the "sent log" UI. */
export const MAX_SENT_LOG = 5;

/**
 * Maximum height (px) of the steering textarea before it stops auto-growing.
 * ~4 lines of 20px line-height plus 10px vertical padding.
 */
export const MAX_INPUT_HEIGHT = 4 * 20 + 10;
