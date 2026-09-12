import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import ImportTab from "../ImportTab.vue";

enableAutoUnmount(afterEach);

const flow = { step: ref("select"), error: ref(null), browseFile: vi.fn() };
vi.mock("@/composables/useImportFlow", () => ({ useImportFlow: () => flow }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("Import file picker accessibility", () => {
  it("exposes a named native file-chooser button and only advertises the supported interaction", async () => {
    const wrapper = mount(ImportTab, { attachTo: document.body });
    const chooser = wrapper.get<HTMLButtonElement>(".drop-zone");
    expect(chooser.element.tagName).toBe("BUTTON");
    expect(chooser.attributes("type")).toBe("button");
    expect(chooser.attributes("aria-label")).toBe("Choose a .tpx.json file");
    expect(chooser.element.tabIndex).toBe(0);
    chooser.element.focus();
    expect(document.activeElement).toBe(chooser.element);
    expect(chooser.text()).toContain("Choose a .tpx.json file");
    expect(chooser.text()).not.toMatch(/drop|drag/i);
    chooser.element.click();
    expect(flow.browseFile).toHaveBeenCalledOnce();
    expect(flow.step.value).toBe("select");
  });
});
