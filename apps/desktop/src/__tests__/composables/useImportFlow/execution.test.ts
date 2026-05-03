import { createDeferred } from "@tracepilot/test-utils";
import type { ImportResult } from "@tracepilot/types";
import "./setup";
import { describe, expect, it, vi } from "vitest";
import { makeImportResult, makePreviewResult } from "./fixtures";
import { client, mountImportFlow, setupUseImportFlowTest } from "./setup";

setupUseImportFlowTest();

async function setupForImport() {
  client.previewImport.mockResolvedValue(makePreviewResult());
  const flow = mountImportFlow();
  flow.filePath.value = "/file.json";
  await flow.validateFile();
  return flow;
}

describe("useImportFlow import execution", () => {
  it("is a no-op when canImport is false", async () => {
    const flow = mountImportFlow();

    await flow.executeImport();

    expect(flow.step.value).toBe("select");
    expect(client.importSessions).not.toHaveBeenCalled();
  });

  it("transitions to complete on successful import", async () => {
    const flow = await setupForImport();
    client.importSessions.mockResolvedValue(makeImportResult());

    await flow.executeImport();

    expect(flow.step.value).toBe("complete");
    expect(flow.importProgress.value).toBe(100);
    expect(flow.importedCount.value).toBe(2);
    expect(flow.skippedCount.value).toBe(0);
    expect(flow.importErrors.value).toEqual([]);
  });

  it("returns to review on import failure", async () => {
    const flow = await setupForImport();
    client.importSessions.mockRejectedValue(new Error("Disk full"));

    await flow.executeImport();

    expect(flow.step.value).toBe("review");
    expect(flow.error.value).toBe("Disk full");
    expect(flow.importProgress.value).toBe(0);
  });

  it("surfaces object-shaped import errors", async () => {
    const flow = await setupForImport();
    client.importSessions.mockRejectedValue({ message: "Serialized import error" });

    await flow.executeImport();

    expect(flow.step.value).toBe("review");
    expect(flow.error.value).toBe("Serialized import error");
  });

  it("falls back for nullish import errors", async () => {
    const flow = await setupForImport();
    client.importSessions.mockRejectedValue(null);

    await flow.executeImport();

    expect(flow.step.value).toBe("review");
    expect(flow.error.value).toBe("Unknown error");
  });

  it("passes conflict strategy and selected sessions to backend", async () => {
    const flow = await setupForImport();
    flow.conflictStrategy.value = "replace";
    flow.selectedSessions.value = ["sess-1"];
    client.importSessions.mockResolvedValue(makeImportResult());

    await flow.executeImport();

    expect(client.importSessions).toHaveBeenCalledWith({
      filePath: "/file.json",
      conflictStrategy: "replace",
      sessionFilter: ["sess-1"],
    });
  });

  it("simulates progress while waiting for backend", async () => {
    const flow = await setupForImport();
    const importDeferred = createDeferred<ImportResult>();
    client.importSessions.mockReturnValue(importDeferred.promise);

    const importPromise = flow.executeImport();

    expect(flow.step.value).toBe("importing");
    expect(flow.importProgress.value).toBe(0);

    vi.advanceTimersByTime(900);
    expect(flow.importProgress.value).toBeGreaterThan(0);
    expect(flow.importProgress.value).toBeLessThanOrEqual(90);

    importDeferred.resolve(makeImportResult());
    await importPromise;

    expect(flow.importProgress.value).toBe(100);
  });

  it("reports warnings from import result", async () => {
    const flow = await setupForImport();
    client.importSessions.mockResolvedValue(
      makeImportResult({
        importedCount: 1,
        skippedCount: 1,
        warnings: ["Session sess-2 already exists"],
      }),
    );

    await flow.executeImport();

    expect(flow.importedCount.value).toBe(1);
    expect(flow.skippedCount.value).toBe(1);
    expect(flow.importErrors.value).toEqual(["Session sess-2 already exists"]);
  });

  it("discards stale import completion after reset", async () => {
    const flow = await setupForImport();
    const importDeferred = createDeferred<ImportResult>();
    client.importSessions.mockReturnValue(importDeferred.promise);

    const importPromise = flow.executeImport();
    expect(flow.step.value).toBe("importing");

    flow.reset();
    expect(flow.step.value).toBe("select");

    importDeferred.resolve(
      makeImportResult({
        importedCount: 99,
        skippedCount: 1,
        warnings: ["stale warning"],
      }),
    );
    await importPromise;

    expect(flow.step.value).toBe("select");
    expect(flow.importedCount.value).toBe(0);
    expect(flow.skippedCount.value).toBe(0);
    expect(flow.importErrors.value).toEqual([]);
    expect(flow.error.value).toBeNull();
    expect(flow.importProgress.value).toBe(0);
  });
});
