import { describe, expect, it } from "vitest";
import {
  isStructuredCheckpoint,
  parseCheckpointSections,
  SECTION_DEFS,
} from "../checkpointParser";

const STRUCTURED_CONTENT = `<overview>
The user wants multi-window support for TracePilot. This includes concurrent session viewing.
</overview>

<history>
1. User asked for deep research into multi-window support.
   - Launched 4 parallel explore agents
   - Created architecture docs
2. User asked for HTML prototypes.
   - Created 8 prototype files
</history>

<work_done>
Files created:
- useWindowRole.ts
- useSessionDetail.ts

Work completed:
- [x] Phase 0 foundation
- [x] Phase 1.0 composable
</work_done>

<technical_details>
## Current Architecture
- Tauri v2 single-window app
- 16 Pinia stores in single JS context

## Key Findings
- Each window gets its own isolated JS context
</technical_details>

<next_steps>
- Implement Phase 2.0 alerting
- Run multi-model reviews
</next_steps>`;

const PLAIN_MARKDOWN = `# Checkpoint 1

This is a plain markdown checkpoint without any XML structure.

## Changes
- Added some files
- Fixed some bugs
`;

const PARTIAL_CONTENT = `<overview>
Brief overview of what happened.
</overview>

Some other content that is not in tags.
`;

describe("isStructuredCheckpoint", () => {
  it("returns true for content with overview tags", () => {
    expect(isStructuredCheckpoint(STRUCTURED_CONTENT)).toBe(true);
  });

  it("returns false for plain markdown", () => {
    expect(isStructuredCheckpoint(PLAIN_MARKDOWN)).toBe(false);
  });

  it("returns true for partial structured content", () => {
    expect(isStructuredCheckpoint(PARTIAL_CONTENT)).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isStructuredCheckpoint("")).toBe(false);
  });

  it("returns false for unclosed overview tag", () => {
    expect(isStructuredCheckpoint("<overview>\nSome text without closing")).toBe(false);
  });

  it("returns false when tags appear only inline (not on own line)", () => {
    const content = "The schema uses `<overview>` and `</overview>` tags for structure.";
    expect(isStructuredCheckpoint(content)).toBe(false);
  });

  it("returns true even when one section has wrong closing tag", () => {
    // Real-world case: LLM closes <history> with </overview> instead of </history>
    const content = `<overview>
Some overview.
</overview>

<history>
Some history.
</overview>`;
    expect(isStructuredCheckpoint(content)).toBe(true);
  });
});

describe("parseCheckpointSections", () => {
  it("parses all sections from full structured content", () => {
    const result = parseCheckpointSections(STRUCTURED_CONTENT);
    expect(result).not.toBeNull();
    expect(result!.overview).toContain("multi-window support");
    expect(result!.history).toContain("Launched 4 parallel explore agents");
    expect(result!.workDone).toContain("useWindowRole.ts");
    expect(result!.technicalDetails).toContain("Tauri v2 single-window");
    expect(result!.nextSteps).toContain("Phase 2.0 alerting");
  });

  it("returns null for plain markdown", () => {
    expect(parseCheckpointSections(PLAIN_MARKDOWN)).toBeNull();
  });

  it("handles partial content (overview only)", () => {
    const result = parseCheckpointSections(PARTIAL_CONTENT);
    expect(result).not.toBeNull();
    expect(result!.overview).toBe("Brief overview of what happened.");
    expect(result!.history).toBeUndefined();
    expect(result!.workDone).toBeUndefined();
    expect(result!.technicalDetails).toBeUndefined();
    expect(result!.nextSteps).toBeUndefined();
  });

  it("trims whitespace from extracted sections", () => {
    const content = `<overview>
  
  Trimmed content here  
  
</overview>`;
    const result = parseCheckpointSections(content);
    expect(result!.overview).toBe("Trimmed content here");
  });

  it("returns null for empty string", () => {
    expect(parseCheckpointSections("")).toBeNull();
  });

  it("ignores inline tag mentions inside structured content", () => {
    const content = `<overview>
Implemented a parser for \`<overview>\` and \`<history>\` tags.
</overview>

<history>
1. Created checkpointParser.ts with \`<overview>\` detection
</history>`;
    const result = parseCheckpointSections(content);
    expect(result).not.toBeNull();
    expect(result!.overview).toContain("Implemented a parser");
    expect(result!.history).toContain("Created checkpointParser.ts");
  });

  it("gracefully handles mismatched closing tag (drops that section)", () => {
    // Real-world case: <history> closed with </overview> instead of </history>
    const content = `<overview>
Some overview.
</overview>

<history>
Some history that was closed with wrong tag.
</overview>

<work_done>
Files created.
</work_done>`;
    const result = parseCheckpointSections(content);
    expect(result).not.toBeNull();
    expect(result!.overview).toBe("Some overview.");
    expect(result!.history).toBeUndefined();
    expect(result!.workDone).toBe("Files created.");
  });

  it("handles completely empty sections", () => {
    const content = `<overview>

</overview>

<history>
</history>`;
    const result = parseCheckpointSections(content);
    expect(result).not.toBeNull();
    expect(result!.overview).toBe("");
    expect(result!.history).toBe("");
  });

  it("handles section with only whitespace", () => {
    const content = `<overview>
   
</overview>`;
    const result = parseCheckpointSections(content);
    expect(result).not.toBeNull();
    expect(result!.overview).toBe("");
  });
});

describe("SECTION_DEFS", () => {
  it("has overview as first entry and defaultExpanded", () => {
    expect(SECTION_DEFS[0].key).toBe("overview");
    expect(SECTION_DEFS[0].defaultExpanded).toBe(true);
  });

  it("has all other sections not expanded by default", () => {
    for (const def of SECTION_DEFS.slice(1)) {
      expect(def.defaultExpanded).toBe(false);
    }
  });

  it("defines 5 sections", () => {
    expect(SECTION_DEFS).toHaveLength(5);
  });
});
