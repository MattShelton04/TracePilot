import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import SearchableSelect from "../components/SearchableSelect.vue";

describe("SearchableSelect", () => {
  let wrapper: VueWrapper<any>;

  const options = ["main", "develop", "feature-x"];

  afterEach(() => {
    vi.restoreAllMocks();
    if (wrapper) {
      wrapper.unmount();
    }
    document.body.innerHTML = "";
  });

  const mountComponent = (propsData = {}) => {
    return mount(SearchableSelect, {
      props: {
        modelValue: "main",
        options,
        ...propsData,
      },
      attachTo: document.body,
    });
  };

  it("renders with the initial modelValue", () => {
    wrapper = mountComponent();
    const input = wrapper.find("input");
    expect((input.element as HTMLInputElement).value).toBe("main");
  });

  it("connects an external label to the actual input when inputId is provided", () => {
    const label = document.createElement("label");
    label.htmlFor = "branch-picker";
    label.textContent = "Branch";
    document.body.append(label);
    wrapper = mountComponent({ inputId: "branch-picker" });
    const input = wrapper.get<HTMLInputElement>("input");
    expect(input.element.id).toBe("branch-picker");
    expect(input.element.labels?.[0]).toBe(label);
  });

  it("resets to modelValue if allowCustom is false and input is blurred", async () => {
    wrapper = mountComponent({ allowCustom: false });
    const input = wrapper.find("input");

    // Clear and blur
    await input.setValue("not-an-option");

    // Simulate clicking outside to trigger close
    document.dispatchEvent(new MouseEvent("mousedown"));
    await nextTick();

    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    expect((input.element as HTMLInputElement).value).toBe("main");
  });

  it("emits custom value if allowCustom is true and input is blurred", async () => {
    wrapper = mountComponent({ allowCustom: true });
    const input = wrapper.find("input");

    await input.setValue("custom-branch");
    document.dispatchEvent(new MouseEvent("mousedown"));
    await nextTick();

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    const emitted = wrapper.emitted("update:modelValue")!;
    expect(emitted[0]).toEqual(["custom-branch"]);
  });

  it("emits empty string when cleared and clearable is true", async () => {
    wrapper = mountComponent({ clearable: true, allowCustom: false });
    const input = wrapper.find("input");

    // Clear input
    await input.setValue("");
    document.dispatchEvent(new MouseEvent("mousedown"));
    await nextTick();

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    const emitted = wrapper.emitted("update:modelValue")!;
    expect(emitted[0]).toEqual([""]);
  });

  it("exposes and activates a named clear button", async () => {
    wrapper = mountComponent({ clearable: true });
    const clearButton = wrapper.get('button[aria-label="Clear selection"]');
    expect(clearButton.get("svg").attributes("aria-hidden")).toBe("true");

    await clearButton.trigger("click");

    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([""]);
    expect(clearButton.attributes("type")).toBe("button");
    expect(document.activeElement).toBe(wrapper.get("input").element);
  });

  it("keeps the popup open while tabbing to Clear, then closes when focus leaves the select", async () => {
    wrapper = mountComponent({ clearable: true, allowCustom: true });
    const input = wrapper.get<HTMLInputElement>("input");
    const after = document.createElement("button");
    document.body.append(after);
    input.element.focus();
    await input.setValue("custom-branch");

    await input.trigger("keydown", { key: "Tab" });
    const clearButton = wrapper.get<HTMLButtonElement>(".clear-btn");
    clearButton.element.focus();
    await nextTick();
    expect(document.querySelector(".tp-select-dropdown")).not.toBeNull();
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();

    await clearButton.trigger("keydown", { key: "Tab" });
    after.focus();
    await nextTick();
    expect(document.querySelector(".tp-select-dropdown")).toBeNull();
    expect(wrapper.emitted("update:modelValue")).toEqual([["custom-branch"]]);
    expect(document.activeElement).toBe(after);
  });

  it("resets an unmatched option when Shift+Tab leaves the input", async () => {
    const before = document.createElement("button");
    document.body.append(before);
    wrapper = mountComponent();
    const input = wrapper.get<HTMLInputElement>("input");
    input.element.focus();
    await input.setValue("not-an-option");
    await input.trigger("keydown", { key: "Tab", shiftKey: true });
    before.focus();
    await nextTick();

    expect(document.querySelector(".tp-select-dropdown")).toBeNull();
    expect(input.element.value).toBe("main");
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    expect(document.activeElement).toBe(before);
  });

  it.each([
    "custom-branch",
    "",
  ])("cancels the draft %j with Escape without clearing, committing or losing focus", async (draft) => {
    wrapper = mountComponent({ allowCustom: true, clearable: true });
    const input = wrapper.get<HTMLInputElement>("input");
    input.element.focus();
    await input.setValue(draft);
    await input.trigger("keydown", { key: "Escape" });

    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    expect(input.element.value).toBe("main");
    expect(document.querySelector(".tp-select-dropdown")).toBeNull();
    expect(document.activeElement).toBe(input.element);
  });

  it("consumes Escape only while the popup is open so a second Escape reaches an outer dialog", async () => {
    wrapper = mountComponent();
    const input = wrapper.get<HTMLInputElement>("input");
    const outerKeydown = vi.fn();
    wrapper.element.parentElement?.addEventListener("keydown", outerKeydown);
    input.element.focus();
    await nextTick();

    await input.trigger("keydown", { key: "Escape" });
    expect(outerKeydown).not.toHaveBeenCalled();
    await input.trigger("keydown", { key: "Escape" });
    expect(outerKeydown).toHaveBeenCalledOnce();
  });

  it.each([
    false,
    true,
  ])("selects an option with arrows and Enter while retaining input focus (clearable: %j)", async (clearable) => {
    wrapper = mountComponent({ modelValue: "", clearable });
    const input = wrapper.get<HTMLInputElement>("input");
    input.element.focus();
    await nextTick();
    for (const option of document.querySelectorAll(".option-item")) {
      Object.defineProperty(option, "scrollIntoView", { value: vi.fn() });
    }
    await input.trigger("keydown", { key: "ArrowDown" });
    await input.trigger("keydown", { key: "ArrowDown" });
    await input.trigger("keydown", { key: "ArrowUp" });
    await input.trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("update:modelValue")).toEqual([["main"]]);
    expect(document.querySelector(".tp-select-dropdown")).toBeNull();
    expect(document.activeElement).toBe(input.element);
  });

  it("cancels with Escape while Clear has keyboard focus", async () => {
    wrapper = mountComponent({ modelValue: "", allowCustom: true, clearable: true });
    const input = wrapper.get<HTMLInputElement>("input");
    input.element.focus();
    await input.setValue("custom-branch");
    const clearButton = wrapper.get<HTMLButtonElement>(".clear-btn");
    clearButton.element.focus();
    await clearButton.trigger("keydown", { key: "Escape" });

    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    expect(input.element.value).toBe("");
    expect(document.querySelector(".tp-select-dropdown")).toBeNull();
    expect(document.activeElement).toBe(input.element);
  });

  it.each([
    false,
    true,
  ])("handles ArrowUp then Enter with no matches (allowCustom: %j)", async (allowCustom) => {
    wrapper = mountComponent({ allowCustom });
    const input = wrapper.get<HTMLInputElement>("input");
    input.element.focus();
    await input.setValue("custom-branch");
    await input.trigger("keydown", { key: "ArrowUp" });
    await input.trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("update:modelValue")).toEqual(
      allowCustom ? [["custom-branch"]] : undefined,
    );
    expect(input.element.value).toBe("custom-branch");
    expect(document.activeElement).toBe(input.element);
  });

  it("disables Clear along with the input", async () => {
    wrapper = mountComponent({ clearable: true, disabled: true });
    const clearButton = wrapper.get<HTMLButtonElement>(".clear-btn");
    expect(clearButton.element.disabled).toBe(true);
    await clearButton.trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  it("does not emit empty string if clearable is false", async () => {
    wrapper = mountComponent({ clearable: false, allowCustom: false });
    const input = wrapper.find("input");

    await input.setValue("");
    document.dispatchEvent(new MouseEvent("mousedown"));
    await nextTick();

    // Should not emit, should revert visually
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    expect((input.element as HTMLInputElement).value).toBe("main");
  });
});
