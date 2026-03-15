import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ModalDialog from "../components/ModalDialog.vue";

describe("ModalDialog", () => {
  it("renders nothing when visible is false", () => {
    const wrapper = mount(ModalDialog, {
      props: { visible: false },
      global: { stubs: { Teleport: true } },
    });
    expect(wrapper.find(".modal-overlay").exists()).toBe(false);
  });

  it("renders modal when visible is true", () => {
    const wrapper = mount(ModalDialog, {
      props: { visible: true, title: "Test" },
      global: { stubs: { Teleport: true } },
    });
    expect(wrapper.find(".modal-overlay").exists()).toBe(true);
    expect(wrapper.find(".modal").exists()).toBe(true);
  });

  it("has aria-modal attribute", () => {
    const wrapper = mount(ModalDialog, {
      props: { visible: true, title: "My Modal" },
      global: { stubs: { Teleport: true } },
    });
    expect(wrapper.find("[role='dialog']").attributes("aria-modal")).toBe("true");
  });

  it("sets aria-label from title prop", () => {
    const wrapper = mount(ModalDialog, {
      props: { visible: true, title: "Settings" },
      global: { stubs: { Teleport: true } },
    });
    expect(wrapper.find("[role='dialog']").attributes("aria-label")).toBe("Settings");
  });

  it("renders title text", () => {
    const wrapper = mount(ModalDialog, {
      props: { visible: true, title: "Confirm" },
      global: { stubs: { Teleport: true } },
    });
    expect(wrapper.find(".modal-header h3").text()).toBe("Confirm");
  });

  it("emits update:visible false when close button clicked", async () => {
    const wrapper = mount(ModalDialog, {
      props: { visible: true, title: "Test" },
      global: { stubs: { Teleport: true } },
    });
    await wrapper.find("button[aria-label='Close']").trigger("click");
    expect(wrapper.emitted("update:visible")).toBeTruthy();
    expect(wrapper.emitted("update:visible")![0]).toEqual([false]);
  });

  it("emits update:visible false on Escape key", async () => {
    const wrapper = mount(ModalDialog, {
      props: { visible: true, title: "Test" },
      global: { stubs: { Teleport: true } },
    });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("update:visible")).toBeTruthy();
    expect(wrapper.emitted("update:visible")![0]).toEqual([false]);
  });

  it("renders default slot content", () => {
    const wrapper = mount(ModalDialog, {
      props: { visible: true, title: "Test" },
      slots: { default: "<p>Body content</p>" },
      global: { stubs: { Teleport: true } },
    });
    expect(wrapper.find(".modal-body").text()).toContain("Body content");
  });
});
