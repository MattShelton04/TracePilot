import type { UpdateCheckResult } from "@tracepilot/client";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const updateResult = ref<UpdateCheckResult | null>(null);
const updateCheckLoading = ref(false);
const updateCheckError = ref<string | null>(null);
const updateCheckedAt = ref<number | null>(null);
const runUpdateCheck = vi.fn();

vi.mock("@/composables/useUpdateCheck", () => ({
  useUpdateCheck: () => ({
    updateResult,
    updateCheckLoading,
    updateCheckError,
    updateCheckedAt,
    runUpdateCheck,
  }),
}));

const { default: UpdateStatusPanel } = await import("@/components/updates/UpdateStatusPanel.vue");

function result(overrides: Partial<UpdateCheckResult> = {}): UpdateCheckResult {
  return {
    currentVersion: "1.4.0",
    latestVersion: "1.4.0",
    hasUpdate: false,
    releaseUrl: null,
    publishedAt: null,
    releaseNotes: null,
    ...overrides,
  };
}

function button(wrapper: ReturnType<typeof mount>, label: string) {
  const match = wrapper.findAll("button").find((b) => b.text() === label);
  if (!match) throw new Error(`No button labelled ${label}`);
  return match;
}

describe("UpdateStatusPanel", () => {
  beforeEach(() => {
    updateResult.value = null;
    updateCheckLoading.value = false;
    updateCheckError.value = null;
    updateCheckedAt.value = null;
    runUpdateCheck.mockClear();
  });

  it("offers a forced check before anything has been checked", async () => {
    const wrapper = mount(UpdateStatusPanel);

    expect(wrapper.get('[role="status"]').text()).toContain("Updates not checked yet");
    await button(wrapper, "Check for updates").trigger("click");
    expect(runUpdateCheck).toHaveBeenCalledWith(true);
  });

  it("shows progress and disables the button while checking", () => {
    updateCheckLoading.value = true;
    const wrapper = mount(UpdateStatusPanel);

    expect(wrapper.classes()).toContain("update-panel--checking");
    expect(wrapper.text()).toContain("Checking for updates…");
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
  });

  it("confirms an up-to-date install and lets people check again", () => {
    updateResult.value = result();
    updateCheckedAt.value = Date.now();
    const wrapper = mount(UpdateStatusPanel);

    expect(wrapper.text()).toContain("You're up to date");
    expect(wrapper.text()).toContain("Checked");
    expect(button(wrapper, "Check again").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Update to");
  });

  it("hands an available update to the install and preview flows", async () => {
    updateResult.value = result({
      latestVersion: "1.5.0",
      hasUpdate: true,
      publishedAt: "2026-03-18T09:00:00Z",
    });
    const wrapper = mount(UpdateStatusPanel);

    expect(wrapper.text()).toContain("v1.5.0 is available");
    expect(wrapper.text()).toContain("Released");
    await button(wrapper, "Update to v1.5.0").trigger("click");
    await button(wrapper, "Preview changes").trigger("click");
    expect(wrapper.emitted("update")).toHaveLength(1);
    expect(wrapper.emitted("preview")).toHaveLength(1);
    expect(runUpdateCheck).not.toHaveBeenCalled();
  });

  it("explains a failed check and retries it", async () => {
    updateCheckError.value = "GitHub API returned 403";
    const wrapper = mount(UpdateStatusPanel);

    expect(wrapper.text()).toContain("Couldn't check for updates");
    expect(wrapper.get(".update-panel-detail").text()).toBe("GitHub API returned 403");
    await button(wrapper, "Check again").trigger("click");
    expect(runUpdateCheck).toHaveBeenCalledWith(true);
  });
});
