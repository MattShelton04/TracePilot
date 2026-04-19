import { ALL_SECTION_IDS } from "@tracepilot/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import {
  EXPORT_PRESETS,
  FORMAT_DESCRIPTIONS,
  SECTION_GROUPS,
  SECTION_ICONS,
  useExportConfig,
} from "../../composables/useExportConfig";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useExportConfig", () => {
  // ── Initial State ──────────────────────────────────────────

  describe("initial state", () => {
    it("defaults format to json", () => {
      const { format } = useExportConfig();
      expect(format.value).toBe("json");
    });

    it("enables all sections by default", () => {
      const { enabledSections } = useExportConfig();
      for (const id of ALL_SECTION_IDS) {
        expect(enabledSections.value.has(id)).toBe(true);
      }
      expect(enabledSections.value.size).toBe(ALL_SECTION_IDS.length);
    });

    it('defaults activePreset to "full"', () => {
      const { activePreset } = useExportConfig();
      expect(activePreset.value).toBe("full");
    });

    it("defaults selectedSessionId to empty string", () => {
      const { selectedSessionId } = useExportConfig();
      expect(selectedSessionId.value).toBe("");
    });

    it("defaults contentDetail with expected values", () => {
      const { contentDetail } = useExportConfig();
      expect(contentDetail.value).toEqual({
        includeSubagentInternals: true,
        includeToolDetails: true,
        includeFullToolResults: false,
      });
    });

    it("defaults redaction with all options disabled", () => {
      const { redaction } = useExportConfig();
      expect(redaction.value).toEqual({
        anonymizePaths: false,
        stripSecrets: false,
        stripPii: false,
      });
    });

    it("starts with no custom presets", () => {
      const { customPresets } = useExportConfig();
      expect(customPresets.value).toEqual([]);
    });

    it("sectionsArray reflects enabledSections", () => {
      const { sectionsArray } = useExportConfig();
      expect(sectionsArray.value).toHaveLength(ALL_SECTION_IDS.length);
      expect(new Set(sectionsArray.value)).toEqual(new Set(ALL_SECTION_IDS));
    });
  });

  // ── allPresets ─────────────────────────────────────────────

  describe("allPresets", () => {
    it("includes all built-in presets", () => {
      const { allPresets } = useExportConfig();
      expect(allPresets.value).toEqual(expect.arrayContaining(EXPORT_PRESETS as unknown[]));
    });

    it("includes custom presets", () => {
      const { allPresets, saveAsPreset } = useExportConfig();
      vi.setSystemTime(new Date("2026-01-01"));
      saveAsPreset("My Custom");
      expect(allPresets.value.length).toBe(EXPORT_PRESETS.length + 1);
      expect(allPresets.value.at(-1)?.label).toBe("My Custom");
    });
  });

  // ── applyPreset ────────────────────────────────────────────

  describe("applyPreset", () => {
    it("applies the team preset — changes format and sections", () => {
      const { format, enabledSections, activePreset, applyPreset } = useExportConfig();

      applyPreset("minimal-team-log");

      expect(format.value).toBe("markdown");
      const preset = EXPORT_PRESETS.find((p) => p.id === "minimal-team-log")!;
      expect([...enabledSections.value]).toEqual(expect.arrayContaining(preset.sections));
      expect(enabledSections.value.size).toBe(preset.sections.length);
      expect(activePreset.value).toBe("minimal-team-log");
    });

    it("applies the analytics preset correctly", () => {
      const { format, enabledSections, activePreset, applyPreset } = useExportConfig();

      applyPreset("full-fidelity-backup");

      expect(format.value).toBe("markdown");
      const preset = EXPORT_PRESETS.find((p) => p.id === "full-fidelity-backup")!;
      expect(enabledSections.value.size).toBe(preset.sections.length);
      expect(activePreset.value).toBe("full-fidelity-backup");
    });

    it("is a no-op for non-existent preset", () => {
      const { format, activePreset, applyPreset } = useExportConfig();

      applyPreset("nonexistent");

      expect(format.value).toBe("json"); // unchanged
      expect(activePreset.value).toBe("full"); // unchanged
    });

    it("does not clear activePreset via the format watcher", async () => {
      const { activePreset, applyPreset } = useExportConfig();

      applyPreset("minimal-team-log");
      // The format watcher fires asynchronously — must survive nextTick
      await nextTick();

      expect(activePreset.value).toBe("minimal-team-log");
    });
  });

  // ── toggleSection ──────────────────────────────────────────

  describe("toggleSection", () => {
    it("removes an enabled section", () => {
      const { enabledSections, toggleSection } = useExportConfig();
      expect(enabledSections.value.has("conversation")).toBe(true);

      toggleSection("conversation");

      expect(enabledSections.value.has("conversation")).toBe(false);
    });

    it("adds a disabled section", () => {
      const { enabledSections, toggleSection } = useExportConfig();

      toggleSection("conversation"); // remove
      toggleSection("conversation"); // add back

      expect(enabledSections.value.has("conversation")).toBe(true);
    });

    it("clears activePreset when toggling", () => {
      const { activePreset, toggleSection } = useExportConfig();
      expect(activePreset.value).toBe("full");

      toggleSection("conversation");

      expect(activePreset.value).toBeNull();
    });
  });

  // ── selectAll / selectNone ─────────────────────────────────

  describe("selectAll", () => {
    it("enables all sections", () => {
      const { enabledSections, toggleSection, selectAll } = useExportConfig();

      toggleSection("conversation");
      toggleSection("events");
      selectAll();

      expect(enabledSections.value.size).toBe(ALL_SECTION_IDS.length);
    });

    it("clears activePreset", () => {
      const { activePreset, selectAll, applyPreset } = useExportConfig();

      applyPreset("minimal-team-log");
      selectAll();

      expect(activePreset.value).toBeNull();
    });
  });

  describe("selectNone", () => {
    it("disables all sections", () => {
      const { enabledSections, selectNone } = useExportConfig();

      selectNone();

      expect(enabledSections.value.size).toBe(0);
    });

    it("clears activePreset", () => {
      const { activePreset, selectNone } = useExportConfig();
      expect(activePreset.value).toBe("full");

      selectNone();

      expect(activePreset.value).toBeNull();
    });
  });

  // ── saveAsPreset / deleteCustomPreset ──────────────────────

  describe("saveAsPreset", () => {
    it("creates a custom preset with current configuration", () => {
      const {
        customPresets,
        format,
        enabledSections: _enabledSections,
        saveAsPreset,
        toggleSection,
      } = useExportConfig();

      // Customize config
      format.value = "markdown";
      toggleSection("conversation"); // remove one section

      vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
      saveAsPreset("My Report");

      expect(customPresets.value).toHaveLength(1);
      const preset = customPresets.value[0];
      expect(preset.label).toBe("My Report");
      expect(preset.icon).toBe("⭐");
      expect(preset.format).toBe("markdown");
      expect(preset.sections).not.toContain("conversation");
      expect(preset.id).toMatch(/^custom-/);
    });

    it("sets activePreset to the new custom preset id", () => {
      const { activePreset, saveAsPreset } = useExportConfig();

      vi.setSystemTime(new Date("2026-01-01"));
      saveAsPreset("Quick");

      expect(activePreset.value).toMatch(/^custom-/);
    });

    it("snapshots sections at call time", () => {
      const {
        enabledSections: _enabledSections,
        customPresets,
        saveAsPreset,
        toggleSection,
      } = useExportConfig();

      saveAsPreset("Before Toggle");
      const sectionsBefore = customPresets.value[0].sections.length;

      toggleSection("conversation"); // modify after saving

      expect(customPresets.value[0].sections.length).toBe(sectionsBefore);
    });
  });

  describe("deleteCustomPreset", () => {
    it("removes a custom preset", () => {
      const { customPresets, saveAsPreset, deleteCustomPreset } = useExportConfig();

      vi.setSystemTime(new Date("2026-01-01"));
      saveAsPreset("ToDelete");
      const presetId = customPresets.value[0].id;

      deleteCustomPreset(presetId);

      expect(customPresets.value).toHaveLength(0);
    });

    it("clears activePreset if it was the deleted preset", () => {
      const { activePreset, saveAsPreset, deleteCustomPreset, customPresets } = useExportConfig();

      saveAsPreset("Active");
      const presetId = customPresets.value[0].id;
      expect(activePreset.value).toBe(presetId);

      deleteCustomPreset(presetId);

      expect(activePreset.value).toBeNull();
    });

    it("does not change activePreset if deleting a different preset", () => {
      const { activePreset, saveAsPreset, deleteCustomPreset, customPresets } = useExportConfig();

      saveAsPreset("First");
      const firstId = customPresets.value[0].id;

      vi.advanceTimersByTime(10); // ensure different Date.now()
      saveAsPreset("Second");
      const secondId = customPresets.value[1].id;
      // activePreset should be the second (most recent)
      expect(activePreset.value).toBe(secondId);

      deleteCustomPreset(firstId);

      expect(activePreset.value).toBe(secondId); // unchanged
    });

    it("is a no-op for built-in preset ids", () => {
      const { customPresets, deleteCustomPreset } = useExportConfig();

      deleteCustomPreset("full");

      expect(customPresets.value).toHaveLength(0); // no crash, no change
    });
  });

  // ── updateContentDetail ────────────────────────────────────

  describe("updateContentDetail", () => {
    it("updates a single content detail option", () => {
      const { contentDetail, updateContentDetail } = useExportConfig();

      updateContentDetail("includeSubagentInternals", false);

      expect(contentDetail.value.includeSubagentInternals).toBe(false);
    });

    it("preserves other content detail options when updating one", () => {
      const { contentDetail, updateContentDetail } = useExportConfig();
      const before = { ...contentDetail.value };

      updateContentDetail("includeFullToolResults", true);

      expect(contentDetail.value.includeSubagentInternals).toBe(before.includeSubagentInternals);
      expect(contentDetail.value.includeToolDetails).toBe(before.includeToolDetails);
      expect(contentDetail.value.includeFullToolResults).toBe(true);
    });

    it("can update each field independently", () => {
      const { contentDetail, updateContentDetail } = useExportConfig();

      updateContentDetail("includeSubagentInternals", false);
      updateContentDetail("includeToolDetails", false);
      updateContentDetail("includeFullToolResults", true);

      expect(contentDetail.value).toEqual({
        includeSubagentInternals: false,
        includeToolDetails: false,
        includeFullToolResults: true,
      });
    });

    it("does not clear activePreset", () => {
      const { activePreset, updateContentDetail } = useExportConfig();
      expect(activePreset.value).toBe("full");

      updateContentDetail("includeSubagentInternals", false);

      expect(activePreset.value).toBe("full");
    });
  });

  // ── updateRedaction ────────────────────────────────────────

  describe("updateRedaction", () => {
    it("updates a single redaction option", () => {
      const { redaction, updateRedaction } = useExportConfig();

      updateRedaction("anonymizePaths", true);

      expect(redaction.value.anonymizePaths).toBe(true);
    });

    it("preserves other redaction options when updating one", () => {
      const { redaction, updateRedaction } = useExportConfig();

      updateRedaction("stripSecrets", true);

      expect(redaction.value.anonymizePaths).toBe(false);
      expect(redaction.value.stripSecrets).toBe(true);
      expect(redaction.value.stripPii).toBe(false);
    });

    it("can update each field independently", () => {
      const { redaction, updateRedaction } = useExportConfig();

      updateRedaction("anonymizePaths", true);
      updateRedaction("stripSecrets", true);
      updateRedaction("stripPii", true);

      expect(redaction.value).toEqual({
        anonymizePaths: true,
        stripSecrets: true,
        stripPii: true,
      });
    });

    it("does not clear activePreset", () => {
      const { activePreset, updateRedaction } = useExportConfig();
      expect(activePreset.value).toBe("full");

      updateRedaction("stripSecrets", true);

      expect(activePreset.value).toBe("full");
    });
  });

  // ── Format Watch ───────────────────────────────────────────

  describe("format watch", () => {
    it("clears activePreset when format changes manually", async () => {
      const { format, activePreset } = useExportConfig();
      expect(activePreset.value).toBe("full");

      format.value = "markdown";
      await nextTick();

      expect(activePreset.value).toBeNull();
    });

    it("does not clear activePreset when format changes via applyPreset", async () => {
      const { activePreset, applyPreset } = useExportConfig();

      applyPreset("minimal-team-log"); // sets format to 'markdown'
      await nextTick();

      expect(activePreset.value).toBe("minimal-team-log");
    });
  });

  // ── sectionsArray ──────────────────────────────────────────

  describe("sectionsArray", () => {
    it("reflects the enabledSections set as an array", () => {
      const { sectionsArray, enabledSections } = useExportConfig();
      expect(new Set(sectionsArray.value)).toEqual(enabledSections.value);
    });

    it("updates when sections change", () => {
      const { sectionsArray, toggleSection } = useExportConfig();
      const initialLength = sectionsArray.value.length;

      toggleSection("conversation");

      expect(sectionsArray.value.length).toBe(initialLength - 1);
      expect(sectionsArray.value).not.toContain("conversation");
    });
  });
});

// ── Exported Constants ───────────────────────────────────────

describe("exported constants", () => {
  it("EXPORT_PRESETS has expected built-in presets", () => {
    const ids = EXPORT_PRESETS.map((p) => p.id);
    expect(ids).toEqual(["full", "minimal-team-log", "agent-context", "full-fidelity-backup"]);
  });

  it("SECTION_GROUPS covers all sections", () => {
    const allGrouped = SECTION_GROUPS.flatMap((g) => g.sections);
    expect(new Set(allGrouped)).toEqual(new Set(ALL_SECTION_IDS));
  });

  it("SECTION_ICONS has an entry for every section", () => {
    for (const id of ALL_SECTION_IDS) {
      expect(SECTION_ICONS[id]).toBeDefined();
    }
  });

  it("FORMAT_DESCRIPTIONS has entries for json and markdown", () => {
    expect(FORMAT_DESCRIPTIONS).toHaveProperty("json");
    expect(FORMAT_DESCRIPTIONS).toHaveProperty("markdown");
  });
});
