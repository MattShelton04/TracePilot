import {
  getConfig,
  saveConfig,
  type ValidateSessionDirResult,
  validateSessionDir,
} from "@tracepilot/client";
import { createDeferred, setupPinia } from "@tracepilot/test-utils";
import { createDefaultConfig } from "@tracepilot/types";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browseForDirectory } from "@/composables/useBrowseDirectory";
import SetupWizard from "../SetupWizard.vue";
import WizardStepDatabase from "../wizard/WizardStepDatabase.vue";
import WizardStepReady from "../wizard/WizardStepReady.vue";
import WizardStepSessionDir from "../wizard/WizardStepSessionDir.vue";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../__tests__/mocks/client");
  return createClientMock({ validateSessionDir: vi.fn() });
});
vi.mock("@/composables/useBrowseDirectory", () => ({ browseForDirectory: vi.fn() }));

const validDirectory: ValidateSessionDirResult = { valid: true, sessionCount: 12, error: null };
const invalidDirectory: ValidateSessionDirResult = {
  valid: false,
  sessionCount: 0,
  error: "Directory does not exist: /missing/session-state",
};

describe("SetupWizard", () => {
  let wrapper: VueWrapper;

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
    vi.mocked(saveConfig).mockReset().mockResolvedValue(undefined);
    vi.mocked(browseForDirectory).mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function mountWizard() {
    wrapper = mount(SetupWizard, { attachTo: document.body });
    await flushPromises();
    return wrapper;
  }

  async function finishTransition() {
    await vi.advanceTimersByTimeAsync(420);
    await flushPromises();
  }

  async function openDirectoryStep() {
    await mountWizard();
    await wrapper.get('[aria-label="Step 3"]').trigger("click");
    await finishTransition();
  }

  it("keeps inactive slides inert while exposing and focusing each new step", async () => {
    await mountWizard();

    for (let currentStep = 0; currentStep < 5; currentStep += 1) {
      const slides = wrapper.findAll(".slide");
      expect(slides).toHaveLength(5);
      expect(wrapper.findAll(".slide[inert]")).toHaveLength(4);
      for (const [index, slide] of slides.entries()) {
        expect(slide.attributes("aria-hidden")).toBe(String(index !== currentStep));
        expect(slide.element.hasAttribute("inert")).toBe(index !== currentStep);
      }
      expect(wrapper.get('[role="tab"][aria-selected="true"]').attributes("aria-label")).toBe(
        `Step ${currentStep + 1}`,
      );
      if (currentStep > 0) {
        expect(document.activeElement).toBe(slides[currentStep].get("h1, h2").element);
      }
      if (currentStep < 4) {
        await slides[currentStep].get(".btn-accent").trigger("click");
        await finishTransition();
      }
    }
  });

  it("supports arrow navigation while leaving path-input arrow keys available for editing", async () => {
    await mountWizard();
    await wrapper.get(".slide:not([inert]) .btn-accent").trigger("keydown", { key: "ArrowRight" });
    await finishTransition();
    expect(wrapper.get(".slide:not([inert]) h2").text()).toContain("Powerful Analytics");

    await wrapper.get(".slide:not([inert]) .btn-accent").trigger("keydown", { key: "ArrowRight" });
    await finishTransition();
    const input = wrapper.get('input[aria-label="Copilot home directory"]');
    await input.trigger("keydown", { key: "ArrowRight" });
    await finishTransition();
    expect(wrapper.get('[role="tab"][aria-selected="true"]').attributes("aria-label")).toBe(
      "Step 3",
    );

    await wrapper.get(".slide:not([inert]) h2").trigger("keydown", { key: "ArrowLeft" });
    await finishTransition();
    expect(wrapper.get(".slide:not([inert]) h2").text()).toContain("Powerful Analytics");
  });

  it("names both directory inputs and announces validation feedback", async () => {
    await openDirectoryStep();
    expect(wrapper.find('input[aria-label="Copilot home directory"]').exists()).toBe(true);
    expect(wrapper.find('input[aria-label="TracePilot data directory"]').exists()).toBe(true);
    expect(wrapper.get('[role="status"]').text()).toContain("Found 12 sessions");
  });

  it("invalidates the previous directory result as soon as the path is edited", async () => {
    await openDirectoryStep();
    const continueButton = wrapper.get(".slide:not([inert]) .btn-accent");
    expect(continueButton.element.hasAttribute("disabled")).toBe(false);

    await wrapper.get('input[aria-label="Copilot home directory"]').setValue("/missing");
    expect(continueButton.element.hasAttribute("disabled")).toBe(true);
    expect(wrapper.get('[role="status"]').text()).not.toContain("Found 12 sessions");

    vi.mocked(validateSessionDir).mockResolvedValueOnce(invalidDirectory);
    await wrapper.get('input[aria-label="Copilot home directory"]').trigger("keydown.enter");
    await flushPromises();
    expect(validateSessionDir).toHaveBeenLastCalledWith("/missing/session-state");
    expect(wrapper.get('[role="status"]').text()).toContain("Directory does not exist");
    expect(continueButton.element.hasAttribute("disabled")).toBe(true);
  });

  it.each([
    "invalid result",
    "rejection",
  ])("ignores a late %s from the old path after Reset succeeds", async (completion) => {
    await openDirectoryStep();
    const oldCheck = createDeferred<ValidateSessionDirResult>();
    vi.mocked(validateSessionDir).mockReturnValueOnce(oldCheck.promise);
    const input = wrapper.get('input[aria-label="Copilot home directory"]');
    await input.setValue("/missing");
    await input.trigger("blur");

    await wrapper.get('[aria-label="Reset Copilot home to default"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain("Found 12 sessions");
    if (completion === "rejection") oldCheck.reject(new Error("Old request failed"));
    else oldCheck.resolve(invalidDirectory);
    await flushPromises();

    expect(wrapper.get('[role="status"]').text()).toContain("Found 12 sessions");
    expect(wrapper.get('[role="status"]').text()).not.toContain("failed");
    expect(wrapper.get(".slide:not([inert]) .btn-accent").element.hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("keeps the new check pending when an older check finishes first", async () => {
    await openDirectoryStep();
    const oldCheck = createDeferred<ValidateSessionDirResult>();
    const newCheck = createDeferred<ValidateSessionDirResult>();
    vi.mocked(validateSessionDir)
      .mockReturnValueOnce(oldCheck.promise)
      .mockReturnValueOnce(newCheck.promise);
    const input = wrapper.get('input[aria-label="Copilot home directory"]');
    await input.setValue("/missing");
    await input.trigger("blur");
    await wrapper.get('[aria-label="Reset Copilot home to default"]').trigger("click");
    oldCheck.resolve(invalidDirectory);
    await flushPromises();

    expect(wrapper.get('[role="status"]').text()).toContain("Checking directory");
    expect(wrapper.get(".slide:not([inert]) .btn-accent").element.hasAttribute("disabled")).toBe(
      true,
    );
    newCheck.resolve(validDirectory);
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain("Found 12 sessions");
  });

  it("does not apply an in-flight success to a path edited without blur", async () => {
    await openDirectoryStep();
    const check = createDeferred<ValidateSessionDirResult>();
    vi.mocked(validateSessionDir).mockReturnValueOnce(check.promise);
    const input = wrapper.get('input[aria-label="Copilot home directory"]');
    await input.trigger("blur");
    await input.setValue("/missing");
    check.resolve(validDirectory);
    await flushPromises();

    expect(wrapper.get('[role="status"]').text()).not.toContain("Found 12 sessions");
    expect(wrapper.get(".slide:not([inert]) .btn-accent").element.hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("requires a home directory instead of validating the fallback for an empty input", async () => {
    await openDirectoryStep();
    vi.mocked(validateSessionDir).mockClear();
    const input = wrapper.get('input[aria-label="Copilot home directory"]');
    await input.setValue(" ");
    await input.trigger("blur");
    await flushPromises();

    expect(validateSessionDir).not.toHaveBeenCalled();
    expect(wrapper.get('[role="status"]').text()).toContain("Enter a Copilot home directory");
    expect(wrapper.get(".slide:not([inert]) .btn-accent").element.hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("blocks dot, arrow and emitted Continue navigation past an invalid current path", async () => {
    await openDirectoryStep();
    const input = wrapper.get('input[aria-label="Copilot home directory"]');
    await input.setValue("/missing");
    expect(wrapper.get<HTMLButtonElement>('[aria-label="Step 5"]').element.disabled).toBe(true);
    vi.mocked(validateSessionDir).mockResolvedValueOnce(invalidDirectory);
    await input.trigger("blur");
    await flushPromises();
    for (const target of ["Step 4", "Step 5"]) {
      await wrapper.get(`[aria-label="${target}"]`).trigger("click");
    }
    wrapper.getComponent(WizardStepSessionDir).vm.$emit("next");
    await wrapper.get(".slide:not([inert]) h2").trigger("keydown", { key: "ArrowRight" });
    await finishTransition();
    expect(wrapper.get('[aria-selected="true"]').attributes("aria-label")).toBe("Step 3");
    wrapper.getComponent(WizardStepReady).vm.$emit("finish");
    await flushPromises();
    expect(saveConfig).not.toHaveBeenCalled();
    await wrapper.get('[aria-label="Step 2"]').trigger("click");
    await finishTransition();
    expect(wrapper.get('[aria-selected="true"]').attributes("aria-label")).toBe("Step 2");
  });

  it("rechecks a previously valid directory before Launch and returns to its error", async () => {
    await mountWizard();
    await wrapper.get('[aria-label="Step 5"]').trigger("click");
    await finishTransition();
    vi.mocked(validateSessionDir).mockResolvedValueOnce(invalidDirectory);
    await wrapper.get(".slide:not([inert]) .btn-accent").trigger("click");
    await flushPromises();
    await finishTransition();
    expect(saveConfig).not.toHaveBeenCalled();
    expect(wrapper.get('[aria-selected="true"]').attributes("aria-label")).toBe("Step 3");
    expect(wrapper.get('[role="status"]').text()).toContain("Directory does not exist");
  });

  it("locks paths and navigation during fresh validation and saves only once", async () => {
    await mountWizard();
    await wrapper.get('[aria-label="Step 5"]').trigger("click");
    await finishTransition();
    const check = createDeferred<ValidateSessionDirResult>();
    const save = createDeferred<void>();
    vi.mocked(validateSessionDir).mockReturnValueOnce(check.promise);
    vi.mocked(saveConfig).mockReturnValueOnce(save.promise);
    wrapper.getComponent(WizardStepReady).vm.$emit("finish");
    wrapper.getComponent(WizardStepReady).vm.$emit("finish");
    wrapper.getComponent(WizardStepSessionDir).vm.$emit("update:copilotHome", "/late-edit");
    wrapper.getComponent(WizardStepDatabase).vm.$emit("update:tracepilotHome", "/late-data");
    await wrapper.get('[aria-label="Step 3"]').trigger("click");
    expect(wrapper.get('[aria-selected="true"]').attributes("aria-label")).toBe("Step 5");
    expect(wrapper.get(".slides-viewport").element.hasAttribute("inert")).toBe(true);
    expect(saveConfig).not.toHaveBeenCalled();
    check.resolve({ ...validDirectory, sessionCount: 42 });
    await flushPromises();
    expect(saveConfig).toHaveBeenCalledOnce();
    expect(vi.mocked(saveConfig).mock.lastCall?.[0].paths).toMatchObject({
      copilotHome: "/copilot",
      sessionStateDir: "/copilot/session-state",
      tracepilotHome: "/tracepilot",
      indexDbPath: "/tracepilot/index.db",
    });
    expect(wrapper.emitted("setup-saved")).toBeUndefined();
    save.resolve();
    await flushPromises();
    wrapper.getComponent(WizardStepReady).vm.$emit("finish");
    await flushPromises();
    expect(saveConfig).toHaveBeenCalledOnce();
    expect(wrapper.emitted("setup-saved")).toEqual([[42]]);
  });

  it.each([
    validDirectory,
    invalidDirectory,
  ])("Skip uses startup defaults even with edited paths and default validity $valid", async (defaultResult) => {
    vi.mocked(validateSessionDir).mockResolvedValue(defaultResult);
    await openDirectoryStep();
    // Events model edits made on visited slides, before choosing Skip.
    wrapper.getComponent(WizardStepDatabase).vm.$emit("update:tracepilotHome", "/edited-data");
    await wrapper.get('input[aria-label="Copilot home directory"]').setValue("/edited-missing");
    await wrapper.get(".skip-link").trigger("click");
    await flushPromises();
    expect(saveConfig).toHaveBeenCalledOnce();
    expect(vi.mocked(saveConfig).mock.lastCall?.[0]).toMatchObject({
      paths: {
        copilotHome: "/copilot",
        sessionStateDir: "/copilot/session-state",
        tracepilotHome: "/tracepilot",
        indexDbPath: "/tracepilot/index.db",
      },
      general: { setupComplete: true },
    });
    expect(wrapper.emitted("setup-complete")).toEqual([[]]);
    expect(wrapper.emitted("setup-saved")).toBeUndefined();
  });

  it("waits for backend defaults before allowing Skip", async () => {
    const config = createDeferred<ReturnType<typeof createDefaultConfig>>();
    vi.mocked(getConfig).mockReturnValueOnce(config.promise);
    await mountWizard();
    expect(wrapper.get<HTMLButtonElement>(".skip-link").element.disabled).toBe(true);
    await wrapper.get(".skip-link").trigger("click");
    expect(saveConfig).not.toHaveBeenCalled();
    config.resolve(
      createDefaultConfig({ paths: { copilotHome: "/loaded", tracepilotHome: "/loaded-data" } }),
    );
    await flushPromises();
    await wrapper.get(".skip-link").trigger("click");
    await flushPromises();
    expect(vi.mocked(saveConfig).mock.lastCall?.[0].paths.copilotHome).toBe("/loaded");
  });

  it("ignores a directory picker reply that arrives after setup has saved", async () => {
    await openDirectoryStep();
    const selected = createDeferred<string | null>();
    vi.mocked(browseForDirectory).mockReturnValueOnce(selected.promise);
    await wrapper.get(".slide:not([inert]) .btn-browse").trigger("click");
    await wrapper.get('[aria-label="Step 5"]').trigger("click");
    await finishTransition();
    await wrapper.get(".slide:not([inert]) .btn-accent").trigger("click");
    await flushPromises();
    selected.resolve("/late-picker");
    await flushPromises();
    expect(
      wrapper.get<HTMLInputElement>('input[aria-label="Copilot home directory"]').element.value,
    ).toBe("/copilot");
    expect(saveConfig).toHaveBeenCalledOnce();
  });

  it("shows a Skip save failure on the current slide and allows retry", async () => {
    await mountWizard();
    vi.mocked(saveConfig).mockRejectedValueOnce(new Error("Fixture write failed"));
    await wrapper.get(".skip-link").trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("Fixture write failed");
    expect(wrapper.get<HTMLButtonElement>(".skip-link").element.disabled).toBe(false);
    await wrapper.get(".skip-link").trigger("click");
    await flushPromises();
    expect(saveConfig).toHaveBeenCalledTimes(2);
    expect(wrapper.emitted("setup-complete")).toEqual([[]]);
  });
});
