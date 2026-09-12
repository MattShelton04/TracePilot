import type { SessionListItem } from "@tracepilot/types";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import ExportSessionPicker from "../ExportSessionPicker.vue";

enableAutoUnmount(afterEach);

const sessions: SessionListItem[] = [
  { id: "unrelated", summary: "Another session", isRunning: false },
  {
    id: "first-session",
    summary: "Audit duplicate session title",
    repository: "audit/demo",
    currentModel: "model-a",
    isRunning: false,
  },
  {
    id: "second-session",
    summary: "Audit duplicate session title",
    repository: "audit/second-repository",
    currentModel: "model-b",
    isRunning: false,
  },
];

function mountPicker(selectedSession?: SessionListItem) {
  return mount(ExportSessionPicker, {
    attachTo: document.body,
    props: {
      sessions,
      selectedSessionId: selectedSession?.id ?? "",
      selectedSession,
      sectionsInfo: null,
    },
  });
}

describe("Export session picker accessibility", () => {
  it("selects a filtered session with ArrowDown and Enter, distinguishing duplicate titles by ID", async () => {
    const wrapper = mountPicker();
    const input = wrapper.get<HTMLInputElement>("input");
    input.element.focus();
    await input.setValue("Audit duplicate session title");
    await input.trigger("keydown", { key: "ArrowDown" });
    await input.trigger("keydown", { key: "ArrowDown" });
    await input.trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("select")).toEqual([["second-session"]]);
    expect(wrapper.find(".session-dropdown").exists()).toBe(false);
    expect(document.activeElement).toBe(input.element);
  });

  it("names the combobox and exposes keyboard focus separately from the committed selection", async () => {
    const wrapper = mountPicker(sessions[1]);
    const input = wrapper.get<HTMLInputElement>("input");
    expect(input.attributes("role")).toBe("combobox");
    expect(input.attributes("aria-label")).toBe("Session to export");
    expect(input.element.value).toContain(sessions[1].summary);
    input.element.focus();
    await nextTick();

    const listbox = wrapper.get('[role="listbox"]');
    expect(input.attributes("aria-controls")).toBe(listbox.attributes("id"));
    const options = wrapper.findAll('[role="option"]');
    expect(new Set(options.map((option) => option.attributes("id"))).size).toBe(3);
    expect(options[1].attributes("aria-selected")).toBe("true");
    await input.trigger("keydown", { key: "ArrowDown" });
    expect(input.attributes("aria-activedescendant")).toBe(options[2].attributes("id"));
    expect(options[1].attributes("aria-selected")).toBe("true");
    expect(options[2].text()).toContain("audit/second-repository");
    expect(options[2].text()).toContain("model-b");
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("dismisses on Escape, Tab, focus leaving, or an outside pointer without changing selection", async () => {
    const wrapper = mountPicker(sessions[1]);
    const input = wrapper.get<HTMLInputElement>("input");
    input.element.focus();
    await input.setValue("second-repository");
    await input.trigger("keydown", { key: "Escape" });
    expect(input.attributes("aria-expanded")).toBe("false");
    expect(input.element.value).toContain(sessions[1].summary);
    expect(document.activeElement).toBe(input.element);

    await input.trigger("keydown", { key: "ArrowUp" });
    expect(input.attributes("aria-expanded")).toBe("true");
    await input.trigger("keydown", { key: "Tab" });
    expect(input.attributes("aria-expanded")).toBe("false");

    await input.trigger("keydown", { key: "ArrowDown" });
    await input.trigger("blur");
    await input.trigger("focusout", { relatedTarget: document.body });
    expect(input.attributes("aria-expanded")).toBe("false");

    await input.trigger("focus");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();
    expect(input.attributes("aria-expanded")).toBe("false");
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("keeps results open when the pointer leaves and retains input focus when selecting an option", async () => {
    const wrapper = mountPicker();
    const input = wrapper.get<HTMLInputElement>("input");
    input.element.focus();
    await input.setValue("second-repository");
    await wrapper.get(".session-dropdown").trigger("mouseleave");
    expect(wrapper.find(".session-dropdown").exists()).toBe(true);

    const option = wrapper.get('[role="option"]');
    await option.trigger("mousedown");
    await option.trigger("click");
    expect(wrapper.emitted("select")).toEqual([["second-session"]]);
    expect(document.activeElement).toBe(input.element);
  });

  it("never commits a stale option after filtering or a session-list update", async () => {
    const wrapper = mountPicker();
    const input = wrapper.get<HTMLInputElement>("input");
    input.element.focus();
    await input.trigger("keydown", { key: "ArrowDown" });
    await input.setValue("missing session");
    expect(input.attributes("aria-activedescendant")).toBeUndefined();
    expect(wrapper.get('[role="status"]').text()).toContain("No sessions match");
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("select")).toBeUndefined();

    await input.setValue("second-repository");
    await input.trigger("keydown", { key: "ArrowUp" });
    await wrapper.setProps({ sessions: sessions.slice(0, 2) });
    expect(input.attributes("aria-activedescendant")).toBeUndefined();
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("keeps the active option visible by scrolling only the result list", async () => {
    const wrapper = mountPicker();
    const input = wrapper.get<HTMLInputElement>("input");
    input.element.focus();
    await nextTick();
    const dropdown = wrapper.get<HTMLElement>('[role="listbox"]').element;
    const options = wrapper.findAll<HTMLElement>('[role="option"]');
    Object.defineProperty(dropdown, "clientHeight", { value: 50 });
    for (const [index, option] of options.entries()) {
      Object.defineProperty(option.element, "offsetTop", { value: index * 40 });
      Object.defineProperty(option.element, "offsetHeight", { value: 40 });
    }
    const pageScroll = document.documentElement.scrollTop;
    await input.trigger("keydown", { key: "ArrowUp" });
    await nextTick();
    expect(dropdown.scrollTop).toBe(70);
    expect(document.documentElement.scrollTop).toBe(pageScroll);
  });
});
