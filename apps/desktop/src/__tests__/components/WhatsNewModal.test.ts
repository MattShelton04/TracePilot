import type { ReleaseManifestEntry } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import WhatsNewModal from "@/components/WhatsNewModal.vue";

const markdownContentStub = {
  props: ["content"],
  emits: ["open-external"],
  template: '<div data-testid="remote-release-notes">{{ content }}</div>',
};

const updateStatusPanelStub = {
  emits: ["update", "preview"],
  template: `<div data-testid="update-status-panel">
    <button class="stub-update" @click="$emit('update')" />
    <button class="stub-preview" @click="$emit('preview')" />
  </div>`,
};

function release(version: string, added: string[] = [], requiresReindex = false) {
  return {
    version,
    date: "2026-07-26",
    notes: { added, changed: [], fixed: [] },
    requiresReindex,
  } satisfies ReleaseManifestEntry;
}

function mountModal(props: Partial<InstanceType<typeof WhatsNewModal>["$props"]> = {}) {
  return mount(WhatsNewModal, {
    props: {
      previousVersion: "0.7.1",
      currentVersion: "0.8.0",
      entries: [],
      ...props,
    },
    global: {
      stubs: {
        MarkdownContent: markdownContentStub,
        Teleport: true,
        UpdateStatusPanel: updateStatusPanelStub,
      },
    },
  });
}

describe("WhatsNewModal", () => {
  it("renders remote release notes when the bundled manifest is older", () => {
    const wrapper = mountModal({
      releaseNotes: "## Added\n\n- Remote update details",
    });

    expect(wrapper.get('[data-testid="remote-release-notes"]').text()).toContain(
      "Remote update details",
    );
    expect(wrapper.text()).not.toContain("Release notes could not be loaded");
  });

  it("prefers structured bundled entries when they cover the requested update", () => {
    const wrapper = mountModal({
      entries: [release("0.8.0", ["Bundled update: details"])],
      releaseNotes: "Remote update details",
    });

    expect(wrapper.get(".wn-item-title").text()).toBe("Bundled update");
    expect(wrapper.get(".wn-item-body").text()).toBe("details");
    expect(wrapper.find('[data-testid="remote-release-notes"]').exists()).toBe(false);
  });

  it("keeps the GitHub fallback when neither note source is available", () => {
    const wrapper = mountModal({
      releaseUrl: "https://github.com/MattShelton04/TracePilot/releases/tag/v0.8.0",
    });

    expect(wrapper.text()).toContain("Release notes could not be loaded");
    expect(wrapper.text()).toContain("View release notes on GitHub");
  });

  it("does not list earlier releases when the previous version is a development build", () => {
    const wrapper = mountModal({
      previousVersion: "dev",
      currentVersion: "0.8.0",
      entries: [release("0.8.0", ["Current"]), release("0.7.1", ["Older"])],
    });

    expect(wrapper.text()).toContain("Current");
    expect(wrapper.text()).not.toContain("Older");
  });

  it("offers the update from a preview and names the installed version", async () => {
    const wrapper = mountModal({
      kind: "preview",
      previousVersion: "0.8.2",
      currentVersion: "0.9.0",
    });

    expect(wrapper.text()).toContain("You're on v0.8.2.");
    const update = wrapper.findAll("button").find((b) => b.text() === "Update to v0.9.0");
    await update?.trigger("click");
    expect(wrapper.emitted("update")).toHaveLength(1);
  });

  it("shows the reindex hint once for updates that need it", () => {
    const wrapper = mountModal({ entries: [release("0.8.0", ["Indexed"], true)] });

    expect(wrapper.findAll(".wn-reindex")).toHaveLength(1);
  });

  it("collapses older releases in the history view", async () => {
    const wrapper = mountModal({
      kind: "history",
      previousVersion: "0.0.0",
      currentVersion: "0.8.0",
      entries: ["0.8.0", "0.7.1", "0.7.0", "0.6.7"].map((v) => release(v, [`Notes ${v}`])),
    });

    expect(wrapper.findAll(".wn-version")).toHaveLength(3);
    await wrapper.get(".wn-more").trigger("click");
    expect(wrapper.findAll(".wn-version")).toHaveLength(4);
  });

  it("offers the update check when opened as release history", async () => {
    const wrapper = mountModal({ kind: "history", previousVersion: "0.0.0" });

    expect(wrapper.find('[data-testid="update-status-panel"]').exists()).toBe(true);
    await wrapper.get(".stub-update").trigger("click");
    await wrapper.get(".stub-preview").trigger("click");
    expect(wrapper.emitted("update")).toHaveLength(1);
    expect(wrapper.emitted("preview")).toHaveLength(1);
  });

  it("leaves the update check out of the update and preview notes", () => {
    for (const kind of ["updated", "preview"] as const) {
      const wrapper = mountModal({ kind });
      expect(wrapper.find('[data-testid="update-status-panel"]').exists()).toBe(false);
    }
  });
});
