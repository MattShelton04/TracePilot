import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import SkillEditorView from "@/views/skills/SkillEditorView.vue";

const resizeKey = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useSkillEditor", () => ({
  SkillEditorKey: Symbol("SkillEditorKey"),
  useSkillEditor: () =>
    reactive({
      store: { selectedSkill: { directory: "disposable" }, error: null },
      leftWidth: 50,
      minLeftWidth: 42,
      maxLeftWidth: 57,
      dragging: false,
      containerRef: null,
      isReadOnly: false,
      onMouseDown: vi.fn(),
      onResizeKeyDown: resizeKey,
    }),
}));

describe("Skill editor separator", () => {
  it("exposes its controlled pane, current range and keyboard instructions", async () => {
    const wrapper = mount(SkillEditorView, {
      global: {
        stubs: {
          SkillAssetPreviewModal: true,
          SkillEditorMarkdownEditor: true,
          SkillEditorMetadataForm: true,
          SkillEditorPreviewPane: true,
          SkillEditorStatusBar: true,
          SkillEditorTopBar: true,
        },
      },
    });
    const separator = wrapper.get('[aria-label="Resize editor and preview"]');
    expect(separator.attributes()).toMatchObject({
      tabindex: "0",
      "aria-label": "Resize editor and preview",
      "aria-orientation": "vertical",
      "aria-valuemin": "42",
      "aria-valuemax": "57",
      "aria-valuenow": "50",
      "aria-valuetext": "50% editor width",
    });
    expect(wrapper.get(`[id="${separator.attributes("aria-controls")}"]`).classes()).toContain(
      "panel-left",
    );
    expect(wrapper.get(`[id="${separator.attributes("aria-describedby")}"]`).text()).toContain(
      "Enter resets",
    );
    await separator.trigger("keydown", { key: "ArrowRight" });
    expect(resizeKey).toHaveBeenCalledWith(expect.objectContaining({ key: "ArrowRight" }));

    const source = wrapper.get(".definition-source");
    vi.spyOn(source.element, "getBoundingClientRect").mockReturnValue({ height: 500 } as DOMRect);
    const verticalSplit = wrapper.get('[aria-label="Resize frontmatter and instructions"]');
    expect(verticalSplit.attributes("aria-orientation")).toBe("horizontal");
    expect(
      wrapper
        .get(`[id="${verticalSplit.attributes("aria-controls")}"]`)
        .find("skill-editor-metadata-form-stub")
        .exists(),
    ).toBe(true);
    await verticalSplit.trigger("keydown", { key: "ArrowUp" });
    expect(Number(verticalSplit.attributes("aria-valuenow"))).toBeCloseTo(41.8);
    await verticalSplit.trigger("keydown", { key: "Enter" });
    expect(verticalSplit.attributes("aria-valuenow")).toBe("45");
    wrapper.unmount();
  });
});
