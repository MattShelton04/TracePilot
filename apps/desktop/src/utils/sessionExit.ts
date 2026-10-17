/**
 * How a Copilot session ended, named the same way wherever the app shows
 * it (Overview's Exit tile and Compare's summary chips).
 */

/** Copilot writes `routine` in its shutdown record when a session ends normally. */
export function isNormalExit(shutdownType: string | null | undefined): boolean {
  return shutdownType === "routine";
}

/** The exit's title: "Ended normally", "Ended: <kind>", or "No exit record". */
export function exitTitle(shutdownType: string | null | undefined): string {
  if (!shutdownType) return "No exit record";
  return isNormalExit(shutdownType) ? "Ended normally" : `Ended: ${shutdownType}`;
}
