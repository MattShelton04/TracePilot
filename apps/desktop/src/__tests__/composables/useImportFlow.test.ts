import "./useImportFlow/setup";
import { describe, expect, it } from "vitest";
import { mountImportFlow, setupUseImportFlowTest } from "./useImportFlow/setup";

setupUseImportFlowTest();

describe("useImportFlow initial state", () => {
  it("starts at the select step", () => {
    const flow = mountImportFlow();
    expect(flow.step.value).toBe("select");
  });

  it("has empty file path and name", () => {
    const flow = mountImportFlow();
    expect(flow.filePath.value).toBe("");
    expect(flow.fileName.value).toBe("");
  });

  it("has no preview or error", () => {
    const flow = mountImportFlow();
    expect(flow.preview.value).toBeNull();
    expect(flow.error.value).toBeNull();
  });

  it("defaults conflict strategy to skip", () => {
    const flow = mountImportFlow();
    expect(flow.conflictStrategy.value).toBe("skip");
  });

  it("has empty session selection", () => {
    const flow = mountImportFlow();
    expect(flow.selectedSessions.value).toEqual([]);
  });

  it("has zero progress and counts", () => {
    const flow = mountImportFlow();
    expect(flow.importProgress.value).toBe(0);
    expect(flow.importedCount.value).toBe(0);
    expect(flow.skippedCount.value).toBe(0);
    expect(flow.importErrors.value).toEqual([]);
  });
});
