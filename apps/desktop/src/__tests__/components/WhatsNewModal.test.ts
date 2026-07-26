import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import WhatsNewModal from "@/components/WhatsNewModal.vue";

const markdownContentStub = {
  props: ["content"],
  emits: ["open-external"],
  template: '<div data-testid="remote-release-notes">{{ content }}</div>',
};

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
      entries: [
        {
          version: "0.8.0",
          date: "2026-07-26",
          notes: {
            added: ["Bundled update details"],
            changed: [],
            fixed: [],
          },
        },
      ],
      releaseNotes: "Remote update details",
    });

    expect(wrapper.text()).toContain("Bundled update details");
    expect(wrapper.find('[data-testid="remote-release-notes"]').exists()).toBe(false);
  });

  it("keeps the GitHub fallback when neither note source is available", () => {
    const wrapper = mountModal({
      releaseUrl: "https://github.com/MattShelton04/TracePilot/releases/tag/v0.8.0",
    });

    expect(wrapper.text()).toContain("Release notes could not be loaded");
    expect(wrapper.text()).toContain("View release notes on GitHub");
  });
});
