import type * as ClientModule from "@tracepilot/client";
import { createDefaultConfig } from "@tracepilot/types";
import { vi } from "vitest";

type ClientExports = Partial<typeof ClientModule>;

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
  };

  return { ...base, ...overrides };
}
