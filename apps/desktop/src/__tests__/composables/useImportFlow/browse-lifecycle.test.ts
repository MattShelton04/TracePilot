import { createDeferred } from "@tracepilot/test-utils";
import type { ImportPreviewResult, ImportResult } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import "./setup";
import { describe, expect, it, vi } from "vitest";
import { useImportFlow } from "../../../composables/useImportFlow";
import { makeImportResult, makePreviewResult } from "./fixtures";
import { client, mountImportFlow, setupUseImportFlowTest } from "./setup";

setupUseImportFlowTest();

describe("useImportFlow browseFile", () => {
  it("falls back to prompt when not in Tauri environment", async () => {
    const mockPrompt = vi.fn().mockReturnValue("/path/to/file.tpx.json");
    vi.stubGlobal("prompt", mockPrompt);
    client.previewImport.mockResolvedValue(makePreviewResult());

    const flow = mountImportFlow();
    await flow.browseFile();

    expect(mockPrompt).toHaveBeenCalled();
    expect(flow.filePath.value).toBe("/path/to/file.tpx.json");
    expect(flow.fileName.value).toBe("file.tpx.json");

    vi.unstubAllGlobals();
  });

  it("does nothing when prompt is cancelled", async () => {
    vi.stubGlobal("prompt", vi.fn().mockReturnValue(null));

    const flow = mountImportFlow();
    await flow.browseFile();

    expect(flow.filePath.value).toBe("");
    expect(client.previewImport).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("trims whitespace from prompt input", async () => {
    vi.stubGlobal("prompt", vi.fn().mockReturnValue("  /path/file.json  "));
    client.previewImport.mockResolvedValue(makePreviewResult());

    const flow = mountImportFlow();
    await flow.browseFile();

    expect(flow.filePath.value).toBe("/path/file.json");

    vi.unstubAllGlobals();
  });
});

describe("useImportFlow lifecycle cleanup", () => {
  it("clears the progress timer when the component unmounts mid-import", async () => {
    vi.useRealTimers();
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    let flowRef!: ReturnType<typeof useImportFlow>;

    const Wrapper = {
      setup() {
        flowRef = useImportFlow();
        return {};
      },
      template: "<div />",
    };

    const wrapper = mount(Wrapper);

    flowRef.step.value = "review";
    flowRef.filePath.value = "/file.json";
    flowRef.selectedSessions.value = ["sess-1"];

    const importDeferred = createDeferred<ImportResult>();
    client.importSessions.mockReturnValue(importDeferred.promise);

    const importPromise = flowRef.executeImport();
    await flushPromises();

    expect(flowRef.step.value).toBe("importing");

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(flowRef.importProgress.value).toBeGreaterThan(0);

    clearIntervalSpy.mockClear();
    wrapper.unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();

    importDeferred.resolve(makeImportResult());
    await importPromise;
    clearIntervalSpy.mockRestore();
    vi.useFakeTimers();
  });

  it("invalidates in-flight validation when the component unmounts", async () => {
    vi.useRealTimers();
    let flowRef!: ReturnType<typeof useImportFlow>;

    const Wrapper = {
      setup() {
        flowRef = useImportFlow();
        return {};
      },
      template: "<div />",
    };

    const wrapper = mount(Wrapper);
    const validationDeferred = createDeferred<ImportPreviewResult>();
    client.previewImport.mockReturnValue(validationDeferred.promise);

    flowRef.filePath.value = "/file.json";
    const validatePromise = flowRef.validateFile();
    await flushPromises();

    expect(flowRef.step.value).toBe("validating");

    wrapper.unmount();

    validationDeferred.resolve(makePreviewResult());
    await validatePromise;
    await flushPromises();

    expect(flowRef.preview.value).toBeNull();
    expect(flowRef.step.value).toBe("validating");
    vi.useFakeTimers();
  });

  it("discards stale import completion when the component unmounts", async () => {
    vi.useRealTimers();
    let flowRef!: ReturnType<typeof useImportFlow>;

    const Wrapper = {
      setup() {
        flowRef = useImportFlow();
        return {};
      },
      template: "<div />",
    };

    const wrapper = mount(Wrapper);

    flowRef.step.value = "review";
    flowRef.filePath.value = "/file.json";
    flowRef.selectedSessions.value = ["sess-1"];

    const importDeferred = createDeferred<ImportResult>();
    client.importSessions.mockReturnValue(importDeferred.promise);

    const importPromise = flowRef.executeImport();
    await flushPromises();

    expect(flowRef.step.value).toBe("importing");

    wrapper.unmount();

    importDeferred.resolve(
      makeImportResult({
        importedCount: 7,
        skippedCount: 2,
        warnings: ["stale warning"],
      }),
    );
    await importPromise;
    await flushPromises();

    expect(flowRef.step.value).toBe("importing");
    expect(flowRef.importedCount.value).toBe(0);
    expect(flowRef.skippedCount.value).toBe(0);
    expect(flowRef.importErrors.value).toEqual([]);
    expect(flowRef.error.value).toBeNull();
    expect(flowRef.importProgress.value).toBe(0);
    vi.useFakeTimers();
  });
});
