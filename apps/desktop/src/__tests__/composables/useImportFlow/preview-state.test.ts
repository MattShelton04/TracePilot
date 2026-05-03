import "./setup";
import { describe, expect, it } from "vitest";
import { makePreviewResult } from "./fixtures";
import { client, mountImportFlow, setupUseImportFlowTest } from "./setup";

setupUseImportFlowTest();

describe("useImportFlow preview state", () => {
  describe("hasErrors", () => {
    it("returns false when preview is null", () => {
      const flow = mountImportFlow();
      expect(flow.hasErrors.value).toBe(false);
    });

    it("returns false when preview has no error-severity issues", async () => {
      client.previewImport.mockResolvedValue(
        makePreviewResult({
          issues: [{ severity: "warning", message: "Minor issue" }],
        }),
      );

      const flow = mountImportFlow();
      flow.filePath.value = "/some/file.json";
      await flow.validateFile();

      expect(flow.hasErrors.value).toBe(false);
    });

    it("returns true when preview has error-severity issues", async () => {
      client.previewImport.mockResolvedValue(
        makePreviewResult({
          issues: [{ severity: "error", message: "Fatal issue" }],
        }),
      );

      const flow = mountImportFlow();
      flow.filePath.value = "/some/file.json";
      await flow.validateFile();

      expect(flow.hasErrors.value).toBe(true);
    });
  });

  describe("canImport", () => {
    it("returns false at initial state", () => {
      const flow = mountImportFlow();
      expect(flow.canImport.value).toBe(false);
    });

    it("returns true when step is review, no errors, and sessions selected", async () => {
      client.previewImport.mockResolvedValue(makePreviewResult());

      const flow = mountImportFlow();
      flow.filePath.value = "/file.json";
      await flow.validateFile();

      expect(flow.step.value).toBe("review");
      expect(flow.hasErrors.value).toBe(false);
      expect(flow.selectedSessions.value.length).toBeGreaterThan(0);
      expect(flow.canImport.value).toBe(true);
    });

    it("returns false when step is review but no sessions selected", async () => {
      client.previewImport.mockResolvedValue(makePreviewResult());

      const flow = mountImportFlow();
      flow.filePath.value = "/file.json";
      await flow.validateFile();
      flow.selectedSessions.value = [];

      expect(flow.canImport.value).toBe(false);
    });

    it("returns false when step is review but has errors", async () => {
      client.previewImport.mockResolvedValue(
        makePreviewResult({
          issues: [{ severity: "error", message: "Bad" }],
        }),
      );

      const flow = mountImportFlow();
      flow.filePath.value = "/file.json";
      await flow.validateFile();

      expect(flow.canImport.value).toBe(false);
    });
  });
});
