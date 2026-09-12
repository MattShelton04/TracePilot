import type { InjectionKey } from "vue";
import type { SessionDetailContext } from "../useSessionDetail";

// Vite can serve both original and timestamped modules after HMR. Keep the
// injection identity stable across those evaluations; each provider still owns
// its own context. Type-only imports keep this key outside the data-loader graph.
export const SESSION_DETAIL_KEY: InjectionKey<SessionDetailContext> = Symbol.for(
  "tracepilot.sessionDetail",
);
