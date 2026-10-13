import {
  getConfig,
  saveConfig,
  type ValidateSessionDirResult,
  validateClaudeConfigDir,
  validateSessionDir,
} from "@tracepilot/client";
import { createDeferred } from "@tracepilot/test-utils";
import { createDefaultConfig } from "@tracepilot/types";
import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WizardStepReady from "../wizard/WizardStepReady.vue";
import {
  finishTransition,
  invalidDirectory,
  mountWizard,
  openDirectoryStep,
  useSetupWizardHooks,
  validDirectory,
  wrapper,
} from "./setupWizardHarness";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../__tests__/mocks/client");
  return createClientMock({ validateSessionDir: vi.fn(), validateClaudeConfigDir: vi.fn() });
});
vi.mock("@/composables/useBrowseDirectory", () => ({ browseForDirectory: vi.fn() }));

describe("SetupWizard session sources", () => {
  useSetupWizardHooks();

  describe("without Copilot CLI", () => {
    beforeEach(() => {
      vi.mocked(validateSessionDir).mockResolvedValue({
        ...invalidDirectory,
        error: "Directory does not exist: /copilot/session-state",
      });
    });

    it("continues past a missing default Copilot home and saves it", async () => {
      await openDirectoryStep();
      const status = wrapper.get('[role="status"]').text();
      expect(status).toContain("Copilot CLI not found");
      expect(status).not.toContain("Directory does not exist");
      await wrapper.get(".slide:not([inert]) .btn-accent").trigger("click");
      await finishTransition();
      expect(wrapper.get('[aria-selected="true"]').attributes("aria-label")).toBe("Step 4");

      await wrapper.get('[aria-label="Step 5"]').trigger("click");
      await finishTransition();
      expect(wrapper.getComponent(WizardStepReady).text()).toContain(
        "Copilot sessions · CLI not found",
      );
      await wrapper.get(".slide:not([inert]) .btn-accent").trigger("click");
      await flushPromises();
      expect(vi.mocked(saveConfig).mock.lastCall?.[0].paths).toMatchObject({
        copilotHome: "/copilot",
        sessionStateDir: "/copilot/session-state",
      });
      expect(wrapper.emitted("setup-saved")).toEqual([[0]]);
    });

    it("still blocks a missing Copilot home that is not the default", async () => {
      await openDirectoryStep();
      const input = wrapper.get('input[aria-label="Copilot home directory"]');
      await input.setValue("/typo");
      await input.trigger("blur");
      await flushPromises();
      expect(wrapper.get('[role="status"]').text()).toContain("Directory does not exist");
      expect(wrapper.get('[role="status"]').text()).not.toContain("Copilot CLI not found");
      expect(wrapper.get(".slide:not([inert]) .btn-accent").element.hasAttribute("disabled")).toBe(
        true,
      );
    });

    it("sets up Claude Code alone", async () => {
      const config = createDefaultConfig({
        paths: { copilotHome: "/copilot", tracepilotHome: "/tracepilot" },
      });
      config.sources.claudeCode.configDir = "/claude";
      vi.mocked(getConfig).mockResolvedValue(config);
      vi.mocked(validateClaudeConfigDir).mockResolvedValue({ ...validDirectory, sessionCount: 5 });
      await openDirectoryStep();
      expect(wrapper.get(".slide:not([inert]) .claude-option").text()).toContain(
        "Found 5 Claude Code sessions",
      );
      await wrapper.get('[aria-label="Step 5"]').trigger("click");
      await finishTransition();
      expect(wrapper.getComponent(WizardStepReady).text()).toContain("Claude Code sessions (5)");
      await wrapper.get(".slide:not([inert]) .btn-accent").trigger("click");
      await flushPromises();
      expect(vi.mocked(saveConfig).mock.lastCall?.[0].features.claudeCodeSessions).toBe(true);
    });
  });

  describe("Claude Code option", () => {
    const claudeSwitch = 'button[role="switch"][aria-labelledby="setup-claude-code-label"]';

    function withClaudeFolder(sessionCount: number) {
      const config = createDefaultConfig({
        paths: { copilotHome: "/copilot", tracepilotHome: "/tracepilot" },
      });
      config.sources.claudeCode.configDir = "/claude";
      vi.mocked(getConfig).mockResolvedValue(config);
      vi.mocked(validateClaudeConfigDir).mockResolvedValue({
        valid: true,
        sessionCount,
        error: null,
        missing: false,
      });
    }

    async function launch() {
      await wrapper.get('[aria-label="Step 5"]').trigger("click");
      await finishTransition();
      await wrapper.get(".slide:not([inert]) .btn-accent").trigger("click");
      await flushPromises();
      return vi.mocked(saveConfig).mock.lastCall?.[0];
    }

    it("is hidden without a default Claude Code folder", async () => {
      await openDirectoryStep();
      expect(validateClaudeConfigDir).not.toHaveBeenCalled();
      expect(wrapper.find(claudeSwitch).exists()).toBe(false);
    });

    it.each([
      { valid: true, sessionCount: 0, error: null, missing: false },
      { valid: false, sessionCount: 0, error: "Directory does not exist", missing: true },
    ])("is hidden when the folder check returns $sessionCount sessions, valid $valid", async (result) => {
      withClaudeFolder(0);
      vi.mocked(validateClaudeConfigDir).mockResolvedValue(result);
      await openDirectoryStep();
      expect(validateClaudeConfigDir).toHaveBeenCalledWith("/claude");
      expect(wrapper.find(claudeSwitch).exists()).toBe(false);
      expect((await launch())?.features.claudeCodeSessions).toBe(false);
    });

    it("is offered on by default and turns Claude Code on when setup completes", async () => {
      withClaudeFolder(8);
      await openDirectoryStep();
      const option = wrapper.get(".slide:not([inert]) .claude-option");
      expect(option.text()).toContain("Also index Claude Code sessions (experimental)");
      expect(option.text()).toContain("Found 8 Claude Code sessions in /claude");
      expect(option.text()).toContain("Settings → Claude Code");
      expect(option.text()).toContain("Claude Code deletes transcripts after 30 days by default");
      expect(wrapper.get(claudeSwitch).attributes("aria-checked")).toBe("true");
      await wrapper.get('[aria-label="Step 5"]').trigger("click");
      await finishTransition();
      expect(wrapper.getComponent(WizardStepReady).text()).toContain("Claude Code sessions (8)");
      expect(saveConfig).not.toHaveBeenCalled();
      await wrapper.get(".slide:not([inert]) .btn-accent").trigger("click");
      await flushPromises();
      expect(vi.mocked(saveConfig).mock.lastCall?.[0].features.claudeCodeSessions).toBe(true);
      expect(wrapper.emitted("setup-saved")).toEqual([[12]]);
    });

    it("leaves Claude Code off when the option is turned off", async () => {
      withClaudeFolder(8);
      await openDirectoryStep();
      await wrapper.get(claudeSwitch).trigger("click");
      expect(wrapper.get(claudeSwitch).attributes("aria-checked")).toBe("false");
      expect((await launch())?.features.claudeCodeSessions).toBe(false);
      expect(wrapper.getComponent(WizardStepReady).text()).not.toContain("Claude Code");
    });

    it("keeps Skip on the defaults, which turn Claude Code on when found", async () => {
      withClaudeFolder(8);
      await openDirectoryStep();
      await wrapper.get(claudeSwitch).trigger("click");
      await wrapper.get(".skip-link").trigger("click");
      await flushPromises();
      expect(vi.mocked(saveConfig).mock.lastCall?.[0].features.claudeCodeSessions).toBe(true);
    });

    it("waits for the folder check before a quick Skip saves", async () => {
      withClaudeFolder(8);
      const check = createDeferred<ValidateSessionDirResult>();
      vi.mocked(validateClaudeConfigDir).mockReturnValueOnce(check.promise);
      await mountWizard();
      await wrapper.get(".skip-link").trigger("click");
      await flushPromises();
      expect(saveConfig).not.toHaveBeenCalled();
      check.resolve({ ...validDirectory, sessionCount: 8 });
      await flushPromises();
      expect(vi.mocked(saveConfig).mock.lastCall?.[0].features.claudeCodeSessions).toBe(true);
    });

    it("keeps Claude Code off on Skip when no folder was found", async () => {
      await mountWizard();
      await wrapper.get(".skip-link").trigger("click");
      await flushPromises();
      expect(vi.mocked(saveConfig).mock.lastCall?.[0].features.claudeCodeSessions).toBe(false);
    });
  });
});
