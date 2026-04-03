import type { SkillFrontmatter } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { parseSkillContent, serializeSkillContent } from "../skillFrontmatter";

describe("skillFrontmatter", () => {
  describe("parseSkillContent", () => {
    it("parses standard frontmatter and body", () => {
      const parsed = parseSkillContent(
        "---\nname: code-review\ndescription: Reviews code\n---\nReview carefully.",
      );

      expect(parsed).toEqual({
        frontmatter: {
          name: "code-review",
          description: "Reviews code",
        },
        body: "Review carefully.",
        status: "parsed",
      });
    });

    it("handles BOM and CRLF line endings", () => {
      const parsed = parseSkillContent(
        "\uFEFF---\r\nname: skill\r\ndescription: Uses CRLF\r\n---\r\nBody",
      );

      expect(parsed.frontmatter).toEqual({
        name: "skill",
        description: "Uses CRLF",
      });
      expect(parsed.body).toBe("Body");
      expect(parsed.status).toBe("parsed");
    });

    it("decodes quoted scalar escapes emitted by the backend writer", () => {
      const parsed = parseSkillContent(
        [
          "---",
          "name: quoted-skill",
          'description: "Line one\\nLine two with \\"quotes\\""',
          "resource_globs:",
          '  - "docs\\\\notes.md"',
          "---",
          "Body",
        ].join("\n"),
      );

      expect(parsed.frontmatter).toEqual({
        name: "quoted-skill",
        description: 'Line one\nLine two with "quotes"',
        resource_globs: ["docs\\notes.md"],
      });
    });

    it("parses multiline descriptions, resource globs, auto_attach, and trailing multiline flush", () => {
      const parsed = parseSkillContent(
        [
          "---",
          "name: triage",
          "description: >",
          "  Find regressions",
          "  across multiple files",
          "auto_attach: true",
          "resource_globs:",
          '  - "**/*.ts"',
          "  - docs/**/*.md",
          "---",
          "Do the work.",
        ].join("\n"),
      );

      expect(parsed.frontmatter).toEqual({
        name: "triage",
        description: "Find regressions across multiple files",
        auto_attach: true,
        resource_globs: ["**/*.ts", "docs/**/*.md"],
      });
      expect(parsed.body).toBe("Do the work.");
      expect(parsed.status).toBe("parsed");

      const trailingMultiline = parseSkillContent(
        ["---", "name: trailing", "description: |", "  Last line wins", "---", "Body"].join("\n"),
      );

      expect(trailingMultiline.frontmatter).toEqual({
        name: "trailing",
        description: "Last line wins",
      });
    });

    it("ignores unknown keys while preserving known ones", () => {
      const parsed = parseSkillContent(
        [
          "---",
          "name: kept",
          "description: still kept",
          "unknown_key: ignored",
          "another.field: ignored too",
          "---",
          "Body",
        ].join("\n"),
      );

      expect(parsed.frontmatter).toEqual({
        name: "kept",
        description: "still kept",
      });
    });

    it("returns missing status when no frontmatter exists", () => {
      const parsed = parseSkillContent("Just markdown body");

      expect(parsed).toEqual({
        frontmatter: null,
        body: "Just markdown body",
        status: "missing",
      });
    });

    it("returns malformed status when frontmatter starts but does not close", () => {
      const content = ["---", "name: broken", "description: missing closing delimiter"].join("\n");
      const parsed = parseSkillContent(content);

      expect(parsed).toEqual({
        frontmatter: null,
        body: content,
        status: "malformed",
      });
    });
  });

  describe("serializeSkillContent", () => {
    it("preserves fallback behavior when frontmatter is missing", () => {
      expect(serializeSkillContent(null, "Body only")).toBe("Body only");
    });

    it("serializes known fields in the current output shape", () => {
      const frontmatter: SkillFrontmatter = {
        name: "writer",
        description: "Writes docs",
        auto_attach: true,
        resource_globs: ["**/*.ts", "docs/**/*.md"],
      };

      expect(serializeSkillContent(frontmatter, "Document everything.")).toBe(
        [
          "---",
          "name: writer",
          "description: Writes docs",
          "auto_attach: true",
          "resource_globs:",
          '  - "**/*.ts"',
          "  - docs/**/*.md",
          "---",
          "Document everything.",
        ].join("\n"),
      );
    });

    it("quotes YAML-sensitive scalar values to stay compatible with backend parsing", () => {
      const frontmatter: SkillFrontmatter = {
        name: "quoted-skill",
        description: "Handles HTTP: GET #1\nLine two",
        resource_globs: ["docs\\notes.md", "yes"],
      };

      expect(serializeSkillContent(frontmatter, "Body")).toBe(
        [
          "---",
          "name: quoted-skill",
          'description: "Handles HTTP: GET #1\\nLine two"',
          "resource_globs:",
          "  - docs\\notes.md",
          '  - "yes"',
          "---",
          "Body",
        ].join("\n"),
      );
    });

    it("round-trips parsed semantic content even when formatting normalizes", () => {
      const initial = [
        "---",
        "name: normalize",
        "description: >",
        "  first line",
        "  second line",
        "---",
        "Body",
      ].join("\n");

      const parsed = parseSkillContent(initial);
      const serialized = serializeSkillContent(parsed.frontmatter, parsed.body);
      const reparsed = parseSkillContent(serialized);

      expect(serialized).toBe(
        ["---", "name: normalize", "description: first line second line", "---", "Body"].join("\n"),
      );
      expect(reparsed).toEqual({
        frontmatter: {
          name: "normalize",
          description: "first line second line",
        },
        body: "Body",
        status: "parsed",
      });
    });
  });
});
