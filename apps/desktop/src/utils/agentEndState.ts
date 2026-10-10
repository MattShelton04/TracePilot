/** Label of an agent that never reported back before its session ended. */
export const NO_FINAL_REPORT = "No final report";

/** Tooltip explaining {@link NO_FINAL_REPORT}. */
export const NO_FINAL_REPORT_HINT =
  "The session ended before this agent reported a result; its end time is unknown.";

/**
 * An agent's status once its session can record no more. An unfinished agent
 * in a non-Copilot session that is not live (see `useCountsUpToNow`) will
 * never report, so it reads as `unreported` rather than running. Copilot
 * sessions, live sessions and every other status are unchanged.
 */
export function settledAgentStatus<S extends string>(
  status: S,
  mayStillReport: boolean,
): S | "unreported" {
  return status === "in-progress" && !mayStillReport ? "unreported" : status;
}
