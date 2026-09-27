import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import {
  action,
  deferred,
  expectBusy,
  mocks,
  mountRealConfirmation,
  mountSettingsDataStorage,
} from "./settingsDataStorageFixture";

describe("SettingsDataStorage reset and confirmations", () => {
  it.each([
    "Delete all snapshots…",
    "Reset Everything…",
  ])("keeps %s confirmation exclusive and cancellation non-destructive", async (label) => {
    const wrapper = mountSettingsDataStorage();
    await flushPromises();
    const confirmation = deferred<{ confirmed: boolean }>();
    mocks.confirm.mockReturnValueOnce(confirmation.promise);
    const button = action(wrapper, label);
    button.vm.$emit("click");
    button.vm.$emit("click");
    await nextTick();
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expectBusy(wrapper);
    action(wrapper, "Rebuild").vm.$emit("click");
    expect(mocks.reindexSessionsFull).not.toHaveBeenCalled();
    confirmation.resolve({ confirmed: false });
    await flushPromises();
    expect(mocks.contextCaptureDeleteAll).not.toHaveBeenCalled();
    expect(mocks.factoryReset).not.toHaveBeenCalled();
    expect(action(wrapper, label).props("disabled")).toBe(false);
    expect(action(wrapper, "Rebuild").props("disabled")).toBe(false);
  });

  it("keeps confirmed capture deletion exclusive until the backend finishes", async () => {
    const wrapper = mountSettingsDataStorage();
    await flushPromises();
    const deletion = deferred<number>();
    mocks.confirm.mockResolvedValueOnce({ confirmed: true });
    mocks.contextCaptureDeleteAll.mockReturnValueOnce(deletion.promise);
    await action(wrapper, "Delete all snapshots…").trigger("click");
    await flushPromises();
    expect(mocks.contextCaptureDeleteAll).toHaveBeenCalledOnce();
    expectBusy(wrapper);
    deletion.resolve(3);
    await flushPromises();
    expect(wrapper.text()).toContain("0 saved plaintext snapshots");
    expect(mocks.toast.success).toHaveBeenCalledWith("Deleted 3 captured request snapshots");
    expect(action(wrapper, "Rebuild").props("disabled")).toBe(false);
  });

  it("reports a reset failure and releases the settings operation lock", async () => {
    const wrapper = mountSettingsDataStorage();
    await flushPromises();
    mocks.confirm.mockResolvedValueOnce({ confirmed: true });
    mocks.factoryReset.mockRejectedValueOnce(new Error("Reset unavailable"));
    await action(wrapper, "Reset Everything…").trigger("click");
    await flushPromises();

    expect(mocks.factoryReset).toHaveBeenCalledOnce();
    expect(mocks.toast.error).toHaveBeenCalledWith("Factory reset failed: Reset unavailable");
    expect(action(wrapper, "Reset Everything…").props("disabled")).toBe(false);
    expect(action(wrapper, "Rebuild").props("disabled")).toBe(false);
  });

  it("blocks competing operations while the native directory picker is pending and recovers on cancel", async () => {
    const wrapper = mountSettingsDataStorage();
    await flushPromises();
    const browse = deferred<string | null>();
    mocks.browseForDirectory.mockReturnValueOnce(browse.promise);
    const button = action(wrapper, "Browse…");
    button.vm.$emit("click");
    button.vm.$emit("click");
    await nextTick();
    expectBusy(wrapper);
    action(wrapper, "Rebuild").vm.$emit("click");
    expect(mocks.browseForDirectory).toHaveBeenCalledOnce();
    expect(mocks.reindexSessionsFull).not.toHaveBeenCalled();
    browse.resolve(null);
    await flushPromises();
    expect(action(wrapper, "Browse…").props("disabled")).toBe(false);
    expect(action(wrapper, "Rebuild").props("disabled")).toBe(false);
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  });

  it.each([
    ["Reset Everything…", "Escape"],
    ["Reset Everything…", "Cancel"],
    ["Delete all snapshots…", "Escape"],
    ["Delete all snapshots…", "Cancel"],
  ])("returns focus to %s after real confirmation %s", async (label, dismiss) => {
    const { wrapper } = await mountRealConfirmation();
    const trigger = action(wrapper, label).element as HTMLButtonElement;
    trigger.focus();
    trigger.click();
    await flushPromises();
    expect(trigger.disabled).toBe(true);
    const cancel = document.querySelector<HTMLButtonElement>(
      '[role="alertdialog"] .btn-secondary',
    )!;
    expect(document.activeElement).toBe(cancel);
    if (dismiss === "Escape") {
      cancel.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    } else {
      cancel.click();
    }
    await flushPromises();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(trigger.disabled).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(mocks.factoryReset).not.toHaveBeenCalled();
    expect(mocks.contextCaptureDeleteAll).not.toHaveBeenCalled();
  });

  it("does not move focus out of another modal when a Settings confirmation is canceled", async () => {
    const { wrapper, actualUi } = await mountRealConfirmation();
    const trigger = action(wrapper, "Reset Everything…").element as HTMLButtonElement;
    trigger.focus();
    trigger.click();
    await flushPromises();
    mount(actualUi.ModalDialog, {
      attachTo: document.body,
      props: { visible: true, title: "Another operation" },
      slots: { default: '<input id="other-modal-field">' },
    });
    await flushPromises();
    const field = document.getElementById("other-modal-field")!;
    field.focus();
    const refocus = vi.spyOn(trigger, "focus");
    actualUi.useConfirmDialog().resolve({ confirmed: false, checked: false });
    await flushPromises();
    expect(refocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);
    expect(trigger.disabled).toBe(false);
  });
});
