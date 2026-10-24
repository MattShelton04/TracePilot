import { formatDate } from "@tracepilot/ui";

/**
 * When a search hit happened (Unix seconds), as the user's local date and
 * time; "" when the moment is missing or out of range.
 */
export function formatSearchMoment(unixSeconds: number | null | undefined): string {
  if (unixSeconds == null || !Number.isFinite(unixSeconds)) return "";
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return formatDate(date.toISOString());
}
