/**
 * Shared types for the session-launcher composables.
 *
 * Kept in a leaf module to avoid circular imports between the form,
 * templates, and CLI-preview composables.
 */

export type ReasoningEffort = "low" | "medium" | "high";

/**
 * A single token in the CLI preview. Both the structured part list and the
 * flat string view are derived from the same `CliPart[]` source — keep this
 * shape stable, child components consume `flag` / `value` directly.
 */
export interface CliPart {
  flag: string;
  value?: string;
}
