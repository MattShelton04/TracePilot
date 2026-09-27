import { flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import {
  action,
  config,
  deferred,
  expectBusy,
  mocks,
  mountSettingsDataStorage,
} from "./settingsDataStorageFixture";

describe("SettingsDataStorage paths and maintenance", () => {
  it("keeps path controls locked until the initial config arrives", async () => {
    const pending = deferred<ReturnType<typeof config>>();
    mocks.getConfig.mockReturnValue(pending.promise);
    const wrapper = mountSettingsDataStorage();
    await flushPromises();

    expect(mocks.getConfig).toHaveBeenCalled();
    expectBusy(wrapper);
    action(wrapper, "Browse…").vm.$emit("click");
    action(wrapper, "Apply path changes").vm.$emit("click");
    expect(mocks.browseForDirectory).not.toHaveBeenCalled();
    expect(mocks.updateConfig).not.toHaveBeenCalled();

    pending.resolve(config());
    await flushPromises();
    const inputs = wrapper.findAll<HTMLInputElement>("input");
    expect(inputs.map((input) => input.element.value)).toEqual([
      config().paths.copilotHome,
      config().paths.tracepilotHome,
    ]);
    expect(inputs.every((input) => !input.element.disabled)).toBe(true);
    expect(action(wrapper, "Browse…").props("disabled")).toBe(false);
  });

  it("keeps path edits locked after config failure and recovers on retry", async () => {
    mocks.getConfig.mockRejectedValue(new Error("Config unavailable"));
    const wrapper = mountSettingsDataStorage();
    await flushPromises();

    expect(
      wrapper.findAll<HTMLInputElement>("input").every((input) => input.element.disabled),
    ).toBe(true);
    expect(action(wrapper, "Browse…").props("disabled")).toBe(true);
    expect(action(wrapper, "Apply path changes").props("disabled")).toBe(true);
    expect(action(wrapper, "Rebuild").props("disabled")).toBe(false);
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "Failed to load path settings: Config unavailable",
    );
    action(wrapper, "Browse…").vm.$emit("click");
    expect(mocks.browseForDirectory).not.toHaveBeenCalled();

    const callsBeforeRetry = mocks.getConfig.mock.calls.length;
    mocks.getConfig.mockResolvedValue(config());
    await action(wrapper, "Retry loading paths").trigger("click");
    await flushPromises();
    expect(mocks.getConfig).toHaveBeenCalledTimes(callsBeforeRetry + 1);
    expect(wrapper.findAll<HTMLInputElement>("input")[0].element.value).toBe(
      config().paths.copilotHome,
    );
    expect(action(wrapper, "Browse…").props("disabled")).toBe(false);
    expect(wrapper.text()).not.toContain("Retry loading paths");
  });

  it.each([
    [74, 0, "Indexed 74 sessions"],
    [1, 2, "Indexed 1 session; 2 already up to date"],
    [0, 0, "Indexed 0 sessions"],
  ])("reports indexed and unchanged counts without treating skipped as total", async (indexed, skipped, message) => {
    mocks.rebuildSearchIndex.mockResolvedValue([indexed, skipped]);
    const wrapper = mountSettingsDataStorage();
    await flushPromises();
    await wrapper
      .findAll("button")
      .filter((button) => button.text() === "Rebuild")[1]
      .trigger("click");
    await flushPromises();
    expect(mocks.rebuildSearchIndex).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain(message);
    expect(wrapper.text()).not.toContain(`Indexed ${indexed} of ${skipped}`);
    wrapper.unmount();
  });

  it("keeps browsed path changes as a draft until Apply path changes is clicked", async () => {
    const wrapper = mountSettingsDataStorage();
    await flushPromises();

    expect(wrapper.text()).not.toContain("Sessions directory");

    mocks.browseForDirectory.mockResolvedValue("D:\\TracePilotData");
    const browseButtons = wrapper.findAll("button").filter((button) => button.text() === "Browse…");

    await browseButtons[1].trigger("click");
    await flushPromises();

    expect(mocks.updateConfig).not.toHaveBeenCalled();
    expect((wrapper.findAll("input")[1].element as HTMLInputElement).value).toBe(
      "D:\\TracePilotData",
    );

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Apply path changes")
      ?.trigger("click");
    await flushPromises();

    expect(mocks.updateConfig).toHaveBeenCalledOnce();
    expect(mocks.updateConfig.mock.calls[0][0].paths).toMatchObject({
      tracepilotHome: "D:\\TracePilotData",
      indexDbPath: "D:\\TracePilotData\\index.db",
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Path settings saved");
  });

  it("locks maintenance through delayed path validation and save, using the validated snapshot", async () => {
    const wrapper = mountSettingsDataStorage();
    await flushPromises();
    const validation = deferred<{ valid: boolean; sessionCount: number }>();
    const save = deferred<ReturnType<typeof config>>();
    mocks.validateSessionDir.mockReturnValueOnce(validation.promise);
    mocks.updateConfig.mockReturnValueOnce(save.promise);
    await wrapper.findAll("input")[0].setValue("D:\\AuditCopilot");
    const apply = action(wrapper, "Apply path changes");
    apply.vm.$emit("click");
    apply.vm.$emit("click");
    await nextTick();
    expect(mocks.validateSessionDir).toHaveBeenCalledExactlyOnceWith(
      "D:\\AuditCopilot\\session-state",
    );
    expectBusy(wrapper);
    for (const button of wrapper.findAllComponents({ name: "ActionButton" })) {
      button.vm.$emit("click");
    }
    expect(mocks.reindexSessionsFull).not.toHaveBeenCalled();
    expect(mocks.rebuildSearchIndex).not.toHaveBeenCalled();
    expect(mocks.browseForDirectory).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();

    // An update already queued by a child must not change what was validated.
    wrapper
      .findAllComponents({ name: "FormInput" })[0]
      .vm.$emit("update:modelValue", "D:\\Unvalidated");
    validation.resolve({ valid: true, sessionCount: 74 });
    await flushPromises();
    expectBusy(wrapper);
    wrapper
      .findAllComponents({ name: "FormInput" })[1]
      .vm.$emit("update:modelValue", "D:\\OtherData");
    await flushPromises();
    expect(mocks.updateConfig).toHaveBeenCalledOnce();
    expect(mocks.updateConfig.mock.calls[0][0].paths).toEqual({
      copilotHome: "D:\\AuditCopilot",
      sessionStateDir: "D:\\AuditCopilot\\session-state",
    });
    expectBusy(wrapper);
    action(wrapper, "Rebuild").vm.$emit("click");
    expect(mocks.reindexSessionsFull).not.toHaveBeenCalled();
    save.resolve({
      ...config(),
      paths: { ...config().paths, ...mocks.updateConfig.mock.calls[0][0].paths },
    });
    await flushPromises();
    expect(action(wrapper, "Apply path changes").props("disabled")).toBe(false);
    await action(wrapper, "Rebuild").trigger("click");
    await flushPromises();
    expect(mocks.reindexSessionsFull).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain("Rebuilt analytics for 74 sessions");
  });

  it.each([
    "analytics",
    "search",
  ])("blocks duplicate %s rebuilds and path changes until maintenance completes", async (kind) => {
    const wrapper = mountSettingsDataStorage();
    await flushPromises();
    await wrapper.findAll("input")[0].setValue("D:\\AuditCopilot");
    const rebuild = deferred<[number, number]>();
    const operation = kind === "analytics" ? mocks.reindexSessionsFull : mocks.rebuildSearchIndex;
    operation.mockReturnValueOnce(rebuild.promise);
    const button = action(wrapper, "Rebuild", kind === "analytics" ? 0 : 1);
    button.vm.$emit("click");
    button.vm.$emit("click");
    await nextTick();
    expectBusy(wrapper);
    action(wrapper, "Apply path changes").vm.$emit("click");
    action(wrapper, "Rebuild").vm.$emit("click");
    expect(operation).toHaveBeenCalledOnce();
    expect(
      kind === "analytics" ? mocks.rebuildSearchIndex : mocks.reindexSessionsFull,
    ).not.toHaveBeenCalled();
    expect(mocks.validateSessionDir).not.toHaveBeenCalled();
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    rebuild.resolve([74, 0]);
    await flushPromises();
    await action(wrapper, "Apply path changes").trigger("click");
    await flushPromises();
    expect(mocks.updateConfig).toHaveBeenCalledOnce();
  });

  it.each([
    "validation",
    "save",
  ])("releases the operation lock and preserves the path draft after %s failure", async (failure) => {
    const wrapper = mountSettingsDataStorage();
    await flushPromises();
    await wrapper.findAll("input")[0].setValue("D:\\AuditCopilot");
    if (failure === "validation") {
      mocks.validateSessionDir.mockResolvedValueOnce({ valid: false, error: "Folder not found" });
    } else {
      mocks.updateConfig.mockRejectedValueOnce(new Error("Cannot write config"));
    }
    await action(wrapper, "Apply path changes").trigger("click");
    await flushPromises();
    expect(mocks.toast.error).toHaveBeenCalledWith(
      expect.stringContaining(
        failure === "validation" ? "Folder not found" : "Cannot write config",
      ),
    );
    expect(wrapper.findAll<HTMLInputElement>("input")[0].element.value).toBe("D:\\AuditCopilot");
    expect(action(wrapper, "Apply path changes").props("disabled")).toBe(false);
    expect(action(wrapper, "Rebuild").props("disabled")).toBe(false);
    await action(wrapper, "Apply path changes").trigger("click");
    await flushPromises();
    expect(mocks.toast.success).toHaveBeenCalledWith("Path settings saved");
    expect(action(wrapper, "Apply path changes").props("disabled")).toBe(true);
  });
});
