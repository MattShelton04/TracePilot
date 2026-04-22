import type * as ClientModule from "@tracepilot/client";
import { createDefaultConfig } from "@tracepilot/types";
import { vi } from "vitest";

type ClientExports = Partial<typeof ClientModule>;

// Inlined copy of `@tracepilot/client`'s `IPC_EVENTS` registry. Must stay in
// sync with `packages/client/src/events.ts` — a commandContract-style test
// could pin this in a follow-up if drift becomes a concern. Inlined (rather
// than re-exported) because this file is imported from inside the vi.mock
// factory for "@tracepilot/client", so pulling the symbol from the real
// client module would re-enter the in-flight mock and resolve to `undefined`.
const IPC_EVENTS = {
  INDEXING_STARTED: "indexing-started",
  INDEXING_PROGRESS: "indexing-progress",
  INDEXING_FINISHED: "indexing-finished",
  SEARCH_INDEXING_STARTED: "search-indexing-started",
  SEARCH_INDEXING_PROGRESS: "search-indexing-progress",
  SEARCH_INDEXING_FINISHED: "search-indexing-finished",
  SDK_BRIDGE_EVENT: "sdk-bridge-event",
  SDK_CONNECTION_CHANGED: "sdk-connection-changed",
} as const;

/**
 * Create a consistent mock for @tracepilot/client used across desktop tests.
 * Provides config APIs by default to keep the preferences store from failing
 * when tests only stub the calls they care about.
 */
export function createClientMock(overrides: ClientExports = {}): ClientExports {
  const defaultConfig = createDefaultConfig({
    paths: {
      sessionStateDir: "~/.copilot/session-state",
      indexDbPath: "~/.copilot/tracepilot/index.db",
    },
    general: { setupComplete: true },
  });

  const base: ClientExports = {
    checkConfigExists: vi.fn().mockResolvedValue(true),
    getConfig: vi.fn().mockResolvedValue(defaultConfig),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    IPC_EVENTS,
  };

  return { ...base, ...overrides };
}
