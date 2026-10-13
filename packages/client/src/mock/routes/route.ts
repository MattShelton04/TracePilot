export type MockArgs = Record<string, unknown>;

/** Mock answers for one client module's commands, built per call. */
export type MockRoutes = Record<string, (args: MockArgs) => unknown>;

/** The session a per-session command asks about. */
export function mockSessionId(args: MockArgs): string {
  return typeof args.sessionId === "string" ? args.sessionId : "mock-id";
}
