import { createDeferred } from "@tracepilot/test-utils";
import type { ImportPreviewResult } from "@tracepilot/types";
import "./setup";
import { describe, expect, it } from "vitest";
import { makePreviewResult } from "./fixtures";
import { client, mountImportFlow, setupUseImportFlowTest } from "./setup";

setupUseImportFlowTest();

describe("useImportFlow validation", () => {
  it("early-returns without changing state when filePath is empty", async () => {
    const flow = mountImportFlow();
    await flow.validateFile();

    expect(flow.step.value).toBe("select");
    expect(client.previewImport).not.toHaveBeenCalled();
  });

  it("transitions to review on successful validation", async () => {
    const previewResult = makePreviewResult();
    client.previewImport.mockResolvedValue(previewResult);

    const flow = mountImportFlow();
    flow.filePath.value = "/test/export.tpx.json";
    await flow.validateFile();

    expect(flow.step.value).toBe("review");
    expect(flow.preview.value).toEqual(previewResult);
    expect(flow.error.value).toBeNull();
  });

  it("auto-selects all sessions from the preview", async () => {
    client.previewImport.mockResolvedValue(makePreviewResult());

    const flow = mountImportFlow();
    flow.filePath.value = "/file.json";
    await flow.validateFile();

    expect(flow.selectedSessions.value).toEqual(["sess-1", "sess-2"]);
  });

  it("returns to select step on validation error", async () => {
    client.previewImport.mockRejectedValue(new Error("Invalid format"));

    const flow = mountImportFlow();
    flow.filePath.value = "/file.json";
    await flow.validateFile();

    expect(flow.step.value).toBe("select");
    expect(flow.error.value).toBe("Invalid format");
    expect(flow.preview.value).toBeNull();
  });

  it("handles non-Error rejection", async () => {
    client.previewImport.mockRejectedValue("raw string error");

    const flow = mountImportFlow();
    flow.filePath.value = "/file.json";
    await flow.validateFile();

    expect(flow.error.value).toBe("raw string error");
  });

  it("surfaces object-shaped validation errors", async () => {
    client.previewImport.mockRejectedValue({ message: "Serialized validation error" });

    const flow = mountImportFlow();
    flow.filePath.value = "/file.json";
    await flow.validateFile();

    expect(flow.error.value).toBe("Serialized validation error");
  });

  it("falls back for nullish validation errors", async () => {
    client.previewImport.mockRejectedValue(undefined);

    const flow = mountImportFlow();
    flow.filePath.value = "/file.json";
    await flow.validateFile();

    expect(flow.error.value).toBe("Unknown error");
  });

  it("discards stale responses from rapid file selections", async () => {
    const firstDeferred = createDeferred<ImportPreviewResult>();
    const secondDeferred = createDeferred<ImportPreviewResult>();

    client.previewImport
      .mockReturnValueOnce(firstDeferred.promise)
      .mockReturnValueOnce(secondDeferred.promise);

    const flow = mountImportFlow();
    flow.filePath.value = "/first.json";
    const first = flow.validateFile();

    flow.filePath.value = "/second.json";
    const second = flow.validateFile();

    const secondResult = makePreviewResult({
      sessions: [
        {
          id: "new",
          summary: "New",
          repository: null,
          createdAt: "2026-01-03",
          sectionCount: 2,
          alreadyExists: false,
        },
      ],
    });
    secondDeferred.resolve(secondResult);
    await second;

    firstDeferred.resolve(makePreviewResult());
    await first;

    expect(flow.selectedSessions.value).toEqual(["new"]);
  });

  it("discards stale validation errors when a newer request succeeds", async () => {
    const firstDeferred = createDeferred<ImportPreviewResult>();
    const secondDeferred = createDeferred<ImportPreviewResult>();

    client.previewImport
      .mockReturnValueOnce(firstDeferred.promise)
      .mockReturnValueOnce(secondDeferred.promise);

    const flow = mountImportFlow();
    flow.filePath.value = "/first.json";
    const first = flow.validateFile();

    flow.filePath.value = "/second.json";
    const second = flow.validateFile();

    secondDeferred.resolve(makePreviewResult());
    await second;

    firstDeferred.reject(new Error("Stale validation error"));
    await first;

    expect(flow.step.value).toBe("review");
    expect(flow.error.value).toBeNull();
    expect(flow.selectedSessions.value).toEqual(["sess-1", "sess-2"]);
  });
});
