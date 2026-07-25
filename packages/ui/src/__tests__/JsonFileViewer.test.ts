import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import JsonFileViewer from "../components/file-viewers/JsonFileViewer.vue";

describe("JsonFileViewer", () => {
  it("expands nested JSON containers by default", () => {
    const wrapper = mount(JsonFileViewer, {
      props: { content: '{"outer":{"inner":{"value":1}},"items":[{"id":2}]}' },
    });

    const toggles = wrapper.findAll(".json-node__row--toggle");
    expect(toggles.length).toBeGreaterThanOrEqual(4);
    expect(toggles.every((toggle) => toggle.attributes("aria-expanded") === "true")).toBe(true);
    expect(wrapper.text()).toContain("value");
    expect(wrapper.text()).toContain("id");
  });

  it("can show a compact direct copy action", () => {
    const wrapper = mount(JsonFileViewer, {
      props: { content: '{"value":1}', showCopy: true },
    });
    expect(wrapper.find('[aria-label="Copy JSON"]').exists()).toBe(true);
  });
});
