// Shared mount, timers and backend fixtures for the SetupWizard tests. Each
// test file still declares its own vi.mock calls, which Vitest hoists per file.
import {
  getConfig,
  saveConfig,
  type ValidateSessionDirResult,
  validateClaudeConfigDir,
  validateSessionDir,
} from "@tracepilot/client";
import { setupPinia } from "@tracepilot/test-utils";
import { createDefaultConfig } from "@tracepilot/types";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, vi } from "vitest";
import { browseForDirectory } from "@/composables/useBrowseDirectory";
import SetupWizard from "../SetupWizard.vue";

export const validDirectory: ValidateSessionDirResult = {
  valid: true,
  sessionCount: 12,
  error: null,
  missing: false,
};
export const invalidDirectory: ValidateSessionDirResult = {
  valid: false,
  sessionCount: 0,
  error: "Directory does not exist: /missing/session-state",
  missing: true,
};
export const notADirectory: ValidateSessionDirResult = {
  valid: false,
  sessionCount: 0,
  error: "Path is not a directory: /copilot/session-state",
  missing: false,
};

/** The mounted wizard; a live binding, reassigned by `mountWizard`. */
export let wrapper: VueWrapper;

export function useSetupWizardHooks() {
  beforeEach(() => {
    setupPinia();
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    vi.mocked(getConfig).mockResolvedValue(
      createDefaultConfig({ paths: { copilotHome: "/copilot", tracepilotHome: "/tracepilot" } }),
    );
    vi.mocked(validateSessionDir).mockReset().mockResolvedValue(validDirectory);
    vi.mocked(validateClaudeConfigDir)
      .mockReset()
      .mockResolvedValue({ valid: true, sessionCount: 0, error: null, missing: false });
    vi.mocked(saveConfig).mockReset().mockResolvedValue(undefined);
    vi.mocked(browseForDirectory).mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
}

export async function mountWizard() {
  wrapper = mount(SetupWizard, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}

export async function finishTransition() {
  await vi.advanceTimersByTimeAsync(420);
  await flushPromises();
}

export async function openDirectoryStep() {
  await mountWizard();
  await wrapper.get('[aria-label="Step 3"]').trigger("click");
  await finishTransition();
}
