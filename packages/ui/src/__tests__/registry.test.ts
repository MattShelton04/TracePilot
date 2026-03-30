import { describe, expect, it } from "vitest";
import {
  getRegisteredRenderers,
  getRendererEntry,
  hasArgsRenderer,
  hasResultRenderer,
} from "../components/renderers/registry";

describe("registry", () => {
  describe("getRendererEntry", () => {
    it("returns entry for registered tool 'edit'", () => {
      const entry = getRendererEntry("edit");
      expect(entry).toBeDefined();
      expect(entry!.label).toBe("Edit (Diff View)");
      expect(entry!.resultComponent).toBeDefined();
      expect(entry!.argsComponent).toBeDefined();
    });

    it("returns entry for 'view'", () => {
      const entry = getRendererEntry("view");
      expect(entry).toBeDefined();
      expect(entry!.label).toBe("View (Code Highlight)");
      expect(entry!.resultComponent).toBeDefined();
    });

    it("returns entry for 'powershell'", () => {
      const entry = getRendererEntry("powershell");
      expect(entry).toBeDefined();
      expect(entry!.label).toBe("Shell (Terminal Output)");
    });

    it("returns entry for 'sql'", () => {
      const entry = getRendererEntry("sql");
      expect(entry).toBeDefined();
      expect(entry!.label).toBe("SQL (Query + Table)");
    });

    it("returns entry for 'grep'", () => {
      const entry = getRendererEntry("grep");
      expect(entry).toBeDefined();
      expect(entry!.label).toBe("Grep (Search Results)");
    });

    it("returns entry for 'glob'", () => {
      const entry = getRendererEntry("glob");
      expect(entry).toBeDefined();
      expect(entry!.label).toBe("Glob (File Tree)");
    });

    it("returns undefined for unregistered tool", () => {
      expect(getRendererEntry("unknown_tool")).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      expect(getRendererEntry("")).toBeUndefined();
    });
  });

  describe("getRegisteredRenderers", () => {
    it("returns an array of registered renderers", () => {
      const renderers = getRegisteredRenderers();
      expect(Array.isArray(renderers)).toBe(true);
      expect(renderers.length).toBeGreaterThan(0);
    });

    it("each entry has toolName and label", () => {
      const renderers = getRegisteredRenderers();
      for (const r of renderers) {
        expect(typeof r.toolName).toBe("string");
        expect(typeof r.label).toBe("string");
        expect(r.toolName.length).toBeGreaterThan(0);
        expect(r.label.length).toBeGreaterThan(0);
      }
    });

    it("includes known tools", () => {
      const renderers = getRegisteredRenderers();
      const names = renderers.map((r) => r.toolName);
      expect(names).toContain("edit");
      expect(names).toContain("view");
      expect(names).toContain("create");
      expect(names).toContain("powershell");
      expect(names).toContain("grep");
      expect(names).toContain("glob");
      expect(names).toContain("sql");
    });
  });

  describe("hasResultRenderer", () => {
    it("returns true for tools with result renderers", () => {
      expect(hasResultRenderer("edit")).toBe(true);
      expect(hasResultRenderer("view")).toBe(true);
      expect(hasResultRenderer("powershell")).toBe(true);
      expect(hasResultRenderer("grep")).toBe(true);
      expect(hasResultRenderer("glob")).toBe(true);
      expect(hasResultRenderer("sql")).toBe(true);
    });

    it("returns false for tools without result renderers", () => {
      expect(hasResultRenderer("report_intent")).toBe(false);
    });

    it("returns false for unknown tools", () => {
      expect(hasResultRenderer("nope")).toBe(false);
    });
  });

  describe("hasArgsRenderer", () => {
    it("returns true for 'edit' (has args renderer)", () => {
      expect(hasArgsRenderer("edit")).toBe(true);
    });

    it("returns true for 'create' (has args renderer)", () => {
      expect(hasArgsRenderer("create")).toBe(true);
    });

    it("returns true for 'report_intent' (has args renderer)", () => {
      expect(hasArgsRenderer("report_intent")).toBe(true);
    });

    it("returns false for 'view' (no args renderer)", () => {
      expect(hasArgsRenderer("view")).toBe(false);
    });

    it("returns false for unknown tools", () => {
      expect(hasArgsRenderer("nope")).toBe(false);
    });
  });
});
