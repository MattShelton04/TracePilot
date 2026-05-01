import type { ExportResult } from "@tracepilot/types";

import { NOW } from "./common.js";

export const MOCK_EXPORT_RESULT: ExportResult = {
  sessionsExported: 1,
  filePath: "/tmp/tracepilot-export.json",
  fileSizeBytes: 12345,
  exportedAt: NOW,
};
