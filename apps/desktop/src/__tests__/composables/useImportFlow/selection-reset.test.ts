import { createDeferred } from "@tracepilot/test-utils";
import type { ImportPreviewResult } from "@tracepilot/types";
import "./setup";
import { describe, expect, it } from "vitest";
import { makePreviewResult } from "./fixtures";
import { client, mountImportFlow, setupUseImportFlowTest } from "./setup";

setupUseImportFlowTest();

describe("useImportFlow selection and reset", () => {
  describe("toggleSession", () => {
    it("adds a session to the selection", () => {
      const flow = mountImportFlow();
      flow.toggleSession("sess-1");
      expect(flow.selectedSessions.value).toContain("sess-1");
    });

    it("removes a session that is already selected", () => {
      const flow = mountImportFlow();
      flow.toggleSession("sess-1");
      flow.toggleSession("sess-1");
      expect(flow.selectedSessions.value).not.toContain("sess-1");
    });

    it("add and remove cycle returns to original state", () => {
      const flow = mountImportFlow();
      const before = [...flow.selectedSessions.value];
      flow.toggleSession("sess-1");
      flow.toggleSession("sess-1");
      expect(flow.selectedSessions.value).toEqual(before);
    });

    it("handles multiple sessions independently", () => {
      const flow = mountImportFlow();
      flow.toggleSession("sess-1");
      flow.toggleSession("sess-2");
      expect(flow.selectedSessions.value).toEqual(["sess-1", "sess-2"]);

      flow.toggleSession("sess-1");
      expect(flow.selectedSessions.value).toEqual(["sess-2"]);
    });
  });

  describe("reset", () => {
    it("restores all state to initial values", async () => {
      client.previewImport.mockResolvedValue(makePreviewResult());

      const flow = mountImportFlow();
      flow.filePath.value = "/file.json";
      await flow.validateFile();

      expect(flow.step.value).toBe("review");

      flow.reset();

      expect(flow.step.value).toBe("select");
      expect(flow.filePath.value).toBe("");
      expect(flow.fileName.value).toBe("");
      expect(flow.preview.value).toBeNull();
      expect(flow.error.value).toBeNull();
      expect(flow.conflictStrategy.value).toBe("skip");
      expect(flow.selectedSessions.value).toEqual([]);
      expect(flow.importProgress.value).toBe(0);
      expect(flow.importedCount.value).toBe(0);
      expect(flow.skippedCount.value).toBe(0);
      expect(flow.importErrors.value).toEqual([]);
    });

    it("invalidates in-flight validation requests", async () => {
      const previewDeferred = createDeferred<ImportPreviewResult>();
      client.previewImport.mockReturnValue(previewDeferred.promise);

      const flow = mountImportFlow();
      flow.filePath.value = "/file.json";
      const validatePromise = flow.validateFile();

      flow.reset();

      previewDeferred.resolve(makePreviewResult());
      await validatePromise;

      expect(flow.step.value).toBe("select");
      expect(flow.preview.value).toBeNull();
    });
  });
});
