import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const installType = ref("installed");
const status = ref("idle");
const installUpdate = vi.fn();
const openExternal = vi.fn();

vi.mock("@/composables/useAutoUpdate", () => ({
  useAutoUpdate: () => ({
    status,
    progress: ref(0),
    errorMessage: ref<string | null>(null),
    installType,
    detectInstallType: vi.fn(),
    installUpdate,
  }),
}));
vi.mock("@/composables/useUpdateCheck", () => ({
  useUpdateCheck: () => ({
    updateResult: ref({
      currentVersion: "0.8.2",
      latestVersion: "0.9.0",
      hasUpdate: true,
      releaseUrl: "https://github.com/MattShelton04/TracePilot/releases/tag/v0.9.0",
      publishedAt: "2026-09-27T00:00:00Z",
      releaseNotes: null,
    }),
  }),
}));
vi.mock("@/utils/openExternal", () => ({ openExternal }));

const { default: UpdateInstructionsModal } = await import(
  "@/components/UpdateInstructionsModal.vue"
);

function mountModal() {
  return mount(UpdateInstructionsModal, { global: { stubs: { Teleport: true } } });
}

function button(wrapper: ReturnType<typeof mountModal>, label: string) {
  const match = wrapper.findAll("button").find((b) => b.text() === label);
  if (!match) throw new Error(`No button labelled ${label}`);
  return match;
}

describe("UpdateInstructionsModal", () => {
  beforeEach(() => {
    installType.value = "installed";
    status.value = "idle";
    installUpdate.mockClear();
    openExternal.mockClear();
  });

  it("shows the version change and installs installer builds in one click", async () => {
    const wrapper = mountModal();

    expect(wrapper.get(".up-versions").text()).toContain("v0.8.2");
    expect(wrapper.get(".up-versions").text()).toContain("v0.9.0");
    await button(wrapper, "Install and restart").trigger("click");
    expect(installUpdate).toHaveBeenCalledOnce();
  });

  it("numbers the source update steps", () => {
    installType.value = "source";
    const wrapper = mountModal();

    expect(wrapper.findAll(".up-step-number").map((n) => n.text())).toEqual(["1", "2", "3"]);
    expect(wrapper.text()).toContain("git pull");
  });

  it("sends portable builds to the release download", async () => {
    installType.value = "portable";
    const wrapper = mountModal();

    await button(wrapper, "Open GitHub Releases").trigger("click");
    expect(openExternal).toHaveBeenCalledWith(
      "https://github.com/MattShelton04/TracePilot/releases/tag/v0.9.0",
    );
  });

  it("links to the release notes preview", async () => {
    const wrapper = mountModal();

    await button(wrapper, "What's new in v0.9.0").trigger("click");
    expect(wrapper.emitted("whats-new")).toHaveLength(1);
  });
});
