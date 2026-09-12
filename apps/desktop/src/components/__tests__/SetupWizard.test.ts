import { getConfig, type ValidateSessionDirResult, validateSessionDir } from "@tracepilot/client";
import { createDeferred, setupPinia } from "@tracepilot/test-utils";
import { createDefaultConfig } from "@tracepilot/types";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SetupWizard from "../SetupWizard.vue";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../__tests__/mocks/client");
  return createClientMock({ validateSessionDir: vi.fn() });
});

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
});
