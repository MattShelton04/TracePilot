// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { createDeferred } from "@tracepilot/test-utils";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { defineComponent, h, provide } from "vue";
import { FIXTURE_BACKUPS, FIXTURE_CONFIG, mocks } from "./setup";
import { ConfigInjectorKey, useConfigInjector } from "../../../composables/useConfigInjector";
import ConfigInjectorBackupsTab from "../../../components/configInjector/ConfigInjectorBackupsTab.vue";
import ConfigInjectorGlobalTab from "../../../components/configInjector/ConfigInjectorGlobalTab.vue";

vi.mock("@tracepilot/ui", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@tracepilot/ui")),
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

enableAutoUnmount(afterEach);
const original = { ...FIXTURE_CONFIG, showReasoning: true, renderMarkdown: true };
const restored = { ...original, showReasoning: false };
beforeEach(() => {
  mocks.getCopilotConfig.mockResolvedValue(original);
  mocks.listConfigBackups.mockResolvedValue(FIXTURE_BACKUPS);
  mocks.restoreConfigBackup.mockImplementation(async () => {
    mocks.getCopilotConfig.mockResolvedValue(restored);
  });
});

async function harness() {
  let api!: ReturnType<typeof useConfigInjector>;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useConfigInjector();
        provide(ConfigInjectorKey, api);
        return () =>
          api.store.activeTab === "global"
            ? h(ConfigInjectorGlobalTab)
            : h(ConfigInjectorBackupsTab);
      },
    }),
  );
  await flushPromises();
  const restoreButton = () =>
    wrapper.findAll("button").find((button) => button.text() === "Restore")!;
  async function showGlobal() {
    api.store.setActiveTab("global");
    await flushPromises();
  }
  return { api, wrapper, restoreButton, showGlobal };
}

describe("Config Injector restore refresh", () => {
  it("shows restored disk settings in Global Config instead of offering to save stale buffers", async () => {
    const { api, wrapper, restoreButton, showGlobal } = await harness();
    await restoreButton().trigger("click");
    await flushPromises();
    expect(api.store.copilotConfig?.showReasoning).toBe(false);
    await showGlobal();
    expect(wrapper.get('[role="switch"]').attributes("aria-checked")).toBe("false");
    expect(wrapper.get<HTMLButtonElement>(".config-form > .btn-primary").element.disabled).toBe(
      true,
    );
    expect(wrapper.find(".diff-preview-details").exists()).toBe(false);
  });

  it("prevents duplicate restores while waiting for the write and reread", async () => {
    const pending = createDeferred<void>();
    onTestFinished(() => pending.resolve());
    mocks.restoreConfigBackup.mockReturnValue(pending.promise);
    const { api, wrapper, restoreButton } = await harness();
    await restoreButton().trigger("click");
    expect(wrapper.get<HTMLButtonElement>('[aria-label^="Restore backup"]').element.disabled).toBe(
      true,
    );
    expect(wrapper.get('[aria-label^="Restore backup"]').text()).toBe("Restoring…");
    expect(wrapper.get(".backup-form > button").text()).toBe("Create Backup");
    const duplicate = api.store.restoreBackup("/backup/other", "/restore/other");
    expect(await api.handleRestoreBackup(FIXTURE_BACKUPS[1])).toBe(false);
    expect(await api.store.saveGlobalConfig({ showReasoning: false })).toBe(false);
    expect(mocks.restoreConfigBackup).toHaveBeenCalledTimes(1);
    expect(mocks.saveCopilotConfig).not.toHaveBeenCalled();
    pending.resolve();
    await duplicate;
    await flushPromises();
    expect(api.store.saving).toBe(false);
  });

  it("updates clean fields while preserving unrelated unsaved edits and folder ownership", async () => {
    const { api, wrapper, restoreButton, showGlobal } = await harness();
    api.editModel.value = "custom-pending-model";
    api.editReasoningEffort.value = "low";
    api.editRenderMarkdown.value = false;
    api.editTrustedFolders.value.push("/unsaved/project");
    await restoreButton().trigger("click");
    await flushPromises();
    await showGlobal();
    expect(api.editShowReasoning.value).toBe(false);
    expect(api.editModel.value).toBe("custom-pending-model");
    expect(api.editReasoningEffort.value).toBe("low");
    expect(api.editRenderMarkdown.value).toBe(false);
    expect(api.editTrustedFolders.value).toContain("/unsaved/project");
    expect(api.store.copilotConfig?.trustedFolders).not.toContain("/unsaved/project");
    expect(wrapper.get<HTMLButtonElement>(".config-form > .btn-primary").element.disabled).toBe(
      false,
    );
    expect(
      api.configDiffLines.value.right.find((line) => line.text.includes("showReasoning"))?.changed,
    ).toBe(false);
    expect(mocks.saveCopilotConfig).not.toHaveBeenCalled();
  });

  it("preserves edits made after Restore starts", async () => {
    const pending = createDeferred<void>();
    onTestFinished(() => pending.resolve());
    mocks.restoreConfigBackup.mockImplementation(async () => {
      await pending.promise;
      mocks.getCopilotConfig.mockResolvedValue(restored);
    });
    const { api, restoreButton } = await harness();
    await restoreButton().trigger("click");
    api.editReasoningEffort.value = "medium";
    pending.resolve();
    await flushPromises();
    expect(api.editReasoningEffort.value).toBe("medium");
    expect(api.editShowReasoning.value).toBe(false);
    api.editTrustedFolders.value.push("/later/edit");
    expect(api.store.copilotConfig?.trustedFolders).not.toContain("/later/edit");
  });

  it("preserves a newer edit when an unrelated Save response arrives", async () => {
    const pending = createDeferred<void>();
    onTestFinished(() => pending.resolve());
    const { api } = await harness();
    mocks.saveCopilotConfig.mockImplementation(async () => {
      await pending.promise;
      mocks.getCopilotConfig.mockResolvedValue(restored);
    });
    api.editShowReasoning.value = false;
    api.handleSaveGlobalConfig();
    api.editShowReasoning.value = true;
    pending.resolve();
    await flushPromises();
    expect(api.store.copilotConfig?.showReasoning).toBe(false);
    expect(api.editShowReasoning.value).toBe(true);
    expect(api.hasConfigChanges.value).toBe(true);
  });

  it.each([
    false,
    true,
  ])("refreshes a re-entered editor and preserves new edits (%s)", async (editAfterReentry) => {
    const pending = createDeferred<void>();
    onTestFinished(() => pending.resolve());
    mocks.restoreConfigBackup.mockImplementation(async () => {
      await pending.promise;
      mocks.getCopilotConfig.mockResolvedValue(restored);
    });
    const first = await harness();
    await first.restoreButton().trigger("click");
    first.wrapper.unmount();
    const reopened = await harness();
    expect(reopened.api.editShowReasoning.value).toBe(true);
    if (editAfterReentry) reopened.api.editReasoningEffort.value = "low";
    pending.resolve();
    await flushPromises();
    await reopened.showGlobal();
    expect(reopened.api.store.copilotConfig?.showReasoning).toBe(false);
    expect(reopened.api.editShowReasoning.value).toBe(false);
    expect(reopened.api.hasConfigChanges.value).toBe(editAfterReentry);
    if (editAfterReentry) expect(reopened.api.editReasoningEffort.value).toBe("low");
  });

  it("does not invalidate a newer successful reread when the restore reread finishes last", async () => {
    const pending = createDeferred<typeof restored>();
    onTestFinished(() => pending.resolve(restored));
    const first = await harness();
    mocks.restoreConfigBackup.mockResolvedValue(undefined);
    mocks.getCopilotConfig.mockReturnValueOnce(pending.promise).mockResolvedValue(restored);
    await first.restoreButton().trigger("click");
    await flushPromises();
    first.wrapper.unmount();
    const reopened = await harness();
    expect(reopened.api.store.copilotConfig?.showReasoning).toBe(false);
    pending.resolve(restored);
    await flushPromises();
    expect(reopened.api.store.copilotConfig?.showReasoning).toBe(false);
    expect(reopened.api.editShowReasoning.value).toBe(false);
    expect(reopened.api.hasConfigChanges.value).toBe(false);
    expect(reopened.api.store.error).toBeNull();
  });

  it("keeps buffers and current settings when the restore write fails, then allows retry", async () => {
    mocks.restoreConfigBackup.mockRejectedValueOnce(new Error("Restore denied"));
    const { api, restoreButton } = await harness();
    api.editReasoningEffort.value = "low";
    await restoreButton().trigger("click");
    await flushPromises();
    expect(api.editShowReasoning.value).toBe(true);
    expect(api.editReasoningEffort.value).toBe("low");
    expect(api.store.copilotConfig?.showReasoning).toBe(true);
    expect(api.store.error).toContain("Restore denied");
    expect(api.restoringBackupId.value).toBeNull();
    expect(api.store.saving).toBe(false);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    await restoreButton().trigger("click");
    await flushPromises();
    expect(api.editShowReasoning.value).toBe(false);
    expect(api.editReasoningEffort.value).toBe("low");
  });

  it("blocks stale Save after a successful restore with failed reread and recovers by reloading", async () => {
    mocks.restoreConfigBackup.mockImplementation(async () => {
      mocks.getCopilotConfig.mockRejectedValue(new Error("Settings temporarily unavailable"));
    });
    const { api, wrapper, restoreButton, showGlobal } = await harness();
    await restoreButton().trigger("click");
    await flushPromises();
    expect(api.store.error).toContain("Backup restored, but configuration refresh failed");
    expect(api.store.error).toContain("Settings temporarily unavailable");
    expect(api.store.copilotConfig).toBeNull();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(api.restoringBackupId.value).toBeNull();
    expect(api.store.saving).toBe(false);
    await showGlobal();
    expect(wrapper.get<HTMLButtonElement>(".config-form > .btn-primary").element.disabled).toBe(
      true,
    );
    mocks.getCopilotConfig.mockResolvedValue(restored);
    await api.resetAllDefaults();
    await flushPromises();
    expect(api.editShowReasoning.value).toBe(false);
    expect(api.hasConfigChanges.value).toBe(false);
    expect(api.store.error).toBeNull();
    expect(mocks.restoreConfigBackup).toHaveBeenCalledTimes(1);
  });

  it("refreshes global fields when an unrelated agent refresh fails", async () => {
    const { api, restoreButton } = await harness();
    mocks.getAgentDefinitions.mockRejectedValue(new Error("Agents unavailable"));
    await restoreButton().trigger("click");
    await flushPromises();
    expect(api.editShowReasoning.value).toBe(false);
    expect(api.hasConfigChanges.value).toBe(false);
    expect(api.store.error).toContain("Agents unavailable");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Backup restored");
  });
});
