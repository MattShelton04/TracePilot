import type { SkillAsset } from "@tracepilot/types";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import SkillAssetsTree from "../SkillAssetsTree.vue";

enableAutoUnmount(afterEach);
const asset: SkillAsset = {
  path: "checklist.md",
  name: "checklist.md",
  sizeBytes: 53,
  isDirectory: false,
};

describe("Skill asset keyboard controls", () => {
  it("provides independent named native buttons for opening and removing a file", async () => {
    const wrapper = mount(SkillAssetsTree, { props: { assets: [asset] } });
    const open = wrapper.get('button[aria-label="Open asset checklist.md"]');
    const remove = wrapper.get('button[aria-label="Remove asset checklist.md"]');
    expect(open.attributes("type")).toBe("button");
    await open.trigger("click");
    expect(wrapper.emitted("viewAsset")).toEqual([[asset]]);
    await remove.trigger("click");
    expect(wrapper.emitted("removeAsset")).toEqual([[asset.path]]);
    expect(wrapper.emitted("viewAsset")).toHaveLength(1);
  });

  it("keeps read-only assets openable without mutation controls", () => {
    const wrapper = mount(SkillAssetsTree, { props: { assets: [asset], readonly: true } });
    expect(wrapper.find('button[aria-label="Open asset checklist.md"]').exists()).toBe(true);
    expect(wrapper.find(".assets-tree__actions, .assets-tree__remove").exists()).toBe(false);
  });

  it.each(["Escape", "Enter"])("restores New File focus after %s", async (key) => {
    const wrapper = mount(SkillAssetsTree, { props: { assets: [asset] }, attachTo: document.body });
    const trigger = wrapper.get<HTMLButtonElement>(".assets-tree__btn--ghost");
    await trigger.trigger("click");
    const input = wrapper.get<HTMLInputElement>('input[aria-label="New asset file name"]');
    expect(document.activeElement).toBe(input.element);
    await input.setValue("new-file.md");
    await input.trigger("keydown", { key });
    expect(wrapper.find("input").exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    expect(wrapper.emitted("newFile")).toEqual(key === "Enter" ? [["new-file.md"]] : undefined);
  });

  it("cancels on blur without taking focus from the next control or submitting", async () => {
    const wrapper = mount(SkillAssetsTree, { props: { assets: [asset] }, attachTo: document.body });
    await wrapper.get(".assets-tree__btn--ghost").trigger("click");
    await wrapper.get("input").setValue("unfinished.md");
    const next = wrapper.get<HTMLButtonElement>(".assets-tree__btn--primary");
    next.element.focus();
    await wrapper.vm.$nextTick();
    expect(wrapper.find("input").exists()).toBe(false);
    expect(document.activeElement).toBe(next.element);
    expect(wrapper.emitted("newFile")).toBeUndefined();
  });

  it("lets composition finish before submitting a Unicode name", async () => {
    const wrapper = mount(SkillAssetsTree, { props: { assets: [asset] } });
    await wrapper.get(".assets-tree__btn--ghost").trigger("click");
    const input = wrapper.get<HTMLInputElement>("input");
    await input.setValue("note-");
    await input.trigger("compositionstart");
    input.element.value = "note-日本語.md";
    await input.trigger("input");
    for (const key of ["Enter", "Escape"]) {
      const event = new KeyboardEvent("keydown", { key, isComposing: true, cancelable: true });
      input.element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(wrapper.find("input").exists()).toBe(true);
    expect(wrapper.emitted("newFile")).toBeUndefined();
    await input.trigger("compositionend");
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("newFile")).toEqual([["note-日本語.md"]]);
  });
});
