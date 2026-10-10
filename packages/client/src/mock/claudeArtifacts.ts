import type { SessionPlan } from "@tracepilot/types";
import type { FileCheckpoint, FileVersionContent } from "../generated/bindings.js";
import { ts } from "./common.js";

/** Synthetic plan approved through Claude Code's `ExitPlanMode`. */
export const MOCK_CLAUDE_PLAN: SessionPlan = {
  content:
    "# Retry the upload client\n\n1. Wrap `send` in a bounded retry.\n2. Back off between attempts.\n3. Cover both paths with tests.",
};

/** Synthetic rewind points: one file edited twice, one created after the first prompt. */
export const MOCK_CLAUDE_FILE_HISTORY: FileCheckpoint[] = [
  {
    number: 1,
    messageId: "c1a0de00-0000-4000-8000-00000000f001",
    timestamp: ts(-900_000),
    prompt: "Add a retry to the upload client in src/upload.ts.",
    files: [{ path: "src/upload.ts", backup: "5ea7c0de00000001@v1", version: 1, changed: true }],
  },
  {
    number: 2,
    messageId: "c1a0de00-0000-4000-8000-00000000f002",
    timestamp: ts(-420_000),
    prompt: "Add a test for the retry path.",
    files: [
      { path: "src/upload.test.ts", backup: null, version: 1, changed: true },
      { path: "src/upload.ts", backup: "5ea7c0de00000001@v2", version: 2, changed: true },
    ],
  },
];

const VERSIONS: Record<string, string> = {
  "5ea7c0de00000001@v1": "export async function upload(body: Blob) {\n  return send(body);\n}\n",
  "5ea7c0de00000001@v2":
    "export async function upload(body: Blob) {\n  return retry(() => send(body), { attempts: 3 });\n}\n",
};

/** `get_session_file_version` content for a mock file-history backup. */
export function mockFileVersion(args?: Record<string, unknown>): FileVersionContent {
  const content = VERSIONS[String(args?.backup ?? "")] ?? "";
  return { content, binary: false, truncated: false };
}
