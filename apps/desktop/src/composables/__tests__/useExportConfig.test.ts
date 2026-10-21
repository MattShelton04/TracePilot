import { ALL_SECTION_IDS } from "@tracepilot/types";
import { beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { EXPORT_PRESETS, readExportOptions, useExportConfig } from "../useExportConfig";

beforeEach(() => {
  localStorage.clear();
});

describe("useExportConfig", () => {
  it("keeps activePreset when applying a preset", async () => {
    const config = useExportConfig();

    config.applyPreset("minimal-team-log");
    await nextTick();

    const preset = EXPORT_PRESETS.find((p) => p.id === "minimal-team-log");
    expect(config.activePreset.value).toBe("minimal-team-log");
    expect(config.format.value).toBe(preset?.format);
    expect(new Set(config.sectionsArray.value)).toEqual(new Set(preset?.sections ?? []));
  });

  it("gives each built-in preset the same content whichever preset came before", () => {
    for (const preset of EXPORT_PRESETS) {
      const fresh = useExportConfig();
      fresh.applyPreset(preset.id);
      for (const previous of EXPORT_PRESETS) {
        const config = useExportConfig();
        config.applyPreset(previous.id);
        config.applyPreset(preset.id);
        expect(config.contentDetail.value, `${previous.id} then ${preset.id}`).toEqual(
          fresh.contentDetail.value,
        );
      }
    }
  });

  it("restores tool details and subagent internals for Full Archive after Minimal Team Log", () => {
    const config = useExportConfig();
    config.applyPreset("minimal-team-log");
    config.applyPreset("full");

    expect(config.contentDetail.value).toEqual({
      includeSubagentInternals: true,
      includeToolDetails: true,
      includeFullToolResults: false,
    });
  });

  it("a custom preset brings back its content detail and redaction", () => {
    const config = useExportConfig();
    config.applyPreset("agent-context");
    config.updateRedaction("stripSecrets", true);
    config.updateContentDetail("includeToolDetails", false);
    config.saveAsPreset("Share");
    const share = config.activePreset.value as string;

    // Full-Fidelity Backup turns redaction off and tool details on.
    config.applyPreset("full-fidelity-backup");
    config.applyPreset(share);

    expect(config.activePreset.value).toBe(share);
    expect(config.redaction.value).toEqual({
      anonymizePaths: false,
      stripSecrets: true,
      stripPii: false,
    });
    expect(config.contentDetail.value).toEqual({
      includeSubagentInternals: true,
      includeToolDetails: false,
      includeFullToolResults: false,
    });
  });

  it("clears activePreset when an option changes by hand", () => {
    const config = useExportConfig();
    config.applyPreset("minimal-team-log");
    config.updateRedaction("stripPii", true);
    expect(config.activePreset.value).toBeNull();

    config.applyPreset("minimal-team-log");
    config.updateContentDetail("includeToolDetails", true);
    expect(config.activePreset.value).toBeNull();
  });

  it("clears activePreset when format changes manually", async () => {
    const config = useExportConfig();

    config.applyPreset("full");
    await nextTick();

    config.format.value = "markdown";
    await nextTick();

    expect(config.activePreset.value).toBeNull();
  });
});

// Each useExportConfig() call stands for one visit to the Export tab: the
// view mounts it afresh after Import, a reload or a restart.
describe("useExportConfig persistence", () => {
  it("restores format, sections, detail and redaction", async () => {
    const first = useExportConfig();
    first.applyPreset("agent-context");
    first.toggleSection("metrics");
    first.applyPreset("minimal-team-log");
    first.updateRedaction("stripSecrets", true);
    first.updateContentDetail("includeFullToolResults", true);
    await nextTick();

    const next = useExportConfig();

    expect(next.format.value).toBe("markdown");
    expect(new Set(next.sectionsArray.value)).toEqual(new Set(["conversation", "plan", "todos"]));
    // The options changed after the preset, so it is no longer active.
    expect(next.activePreset.value).toBeNull();
    expect(next.redaction.value).toEqual({
      anonymizePaths: false,
      stripSecrets: true,
      stripPii: false,
    });
    expect(next.contentDetail.value.includeFullToolResults).toBe(true);
  });

  it("keeps saved custom presets, and the active one, across visits", async () => {
    const first = useExportConfig();
    first.format.value = "markdown";
    first.selectNone();
    first.toggleSection("plan");
    first.saveAsPreset("Plans only");
    await nextTick();
    const saved = first.activePreset.value;

    const next = useExportConfig();

    expect(next.customPresets.value).toHaveLength(1);
    expect(next.customPresets.value[0]).toMatchObject({
      id: saved,
      label: "Plans only",
      format: "markdown",
      sections: ["plan"],
    });
    expect(next.activePreset.value).toBe(saved);

    next.applyPreset("full");
    next.applyPreset(saved as string);
    expect(next.activePreset.value).toBe(saved);
    expect(next.sectionsArray.value).toEqual(["plan"]);
  });

  it("keeps a custom preset's content detail and redaction across visits", async () => {
    const first = useExportConfig();
    first.updateRedaction("stripSecrets", true);
    first.updateRedaction("anonymizePaths", true);
    first.updateContentDetail("includeFullToolResults", true);
    first.saveAsPreset("Share");
    await nextTick();
    const share = first.activePreset.value as string;

    const next = useExportConfig();
    next.applyPreset("full-fidelity-backup");
    next.applyPreset(share);

    expect(next.redaction.value).toEqual({
      anonymizePaths: true,
      stripSecrets: true,
      stripPii: false,
    });
    expect(next.contentDetail.value).toEqual({
      includeSubagentInternals: true,
      includeToolDetails: true,
      includeFullToolResults: true,
    });
  });

  it("still loads a custom preset saved without content detail or redaction", () => {
    const options = readExportOptions(
      JSON.stringify({
        redaction: { stripSecrets: true },
        customPresets: [
          { id: "custom-1", label: "Old", format: "markdown", sections: ["plan"] },
          {
            id: "custom-2",
            label: "Partial",
            format: "json",
            sections: [],
            contentDetail: { includeToolDetails: false, extra: true },
            redaction: { stripPii: true, anonymizePaths: "yes" },
          },
        ],
      }),
    );

    const [old, partial] = options.customPresets;
    expect(old).toMatchObject({ id: "custom-1", format: "markdown", sections: ["plan"] });
    expect(old.contentDetail).toBeUndefined();
    expect(old.redaction).toBeUndefined();
    expect(partial.contentDetail).toEqual({
      includeSubagentInternals: true,
      includeToolDetails: false,
      includeFullToolResults: false,
    });
    expect(partial.redaction).toEqual({
      anonymizePaths: false,
      stripSecrets: false,
      stripPii: true,
    });
  });

  it("leaves the current options alone when applying an old custom preset", () => {
    localStorage.setItem(
      STORAGE_KEYS.exportOptions,
      JSON.stringify({
        customPresets: [{ id: "custom-1", label: "Old", format: "markdown", sections: ["plan"] }],
      }),
    );
    const config = useExportConfig();
    config.updateRedaction("stripSecrets", true);

    config.applyPreset("custom-1");

    expect(config.activePreset.value).toBe("custom-1");
    expect(config.redaction.value.stripSecrets).toBe(true);
  });

  it("remembers a manual change that cleared the preset", async () => {
    const first = useExportConfig();
    first.format.value = "zip";
    await nextTick();

    const next = useExportConfig();

    expect(next.format.value).toBe("zip");
    expect(next.activePreset.value).toBeNull();
  });

  it("does not remember the selected session", async () => {
    const first = useExportConfig();
    first.selectedSessionId.value = "session-1";
    first.toggleSection("events");
    await nextTick();

    expect(useExportConfig().selectedSessionId.value).toBe("");
    expect(localStorage.getItem(STORAGE_KEYS.exportOptions)).not.toContain("session-1");
  });

  it("drops stored choices that are no longer valid", () => {
    const options = readExportOptions(
      JSON.stringify({
        format: "pdf",
        sections: ["conversation", "screenshots", 4],
        activePreset: "custom-gone",
        contentDetail: { includeToolDetails: false, includeFullToolResults: "yes" },
        redaction: { stripPii: true, extra: true },
        customPresets: [
          { id: "custom-1", label: "Mine", format: "markdown", sections: ["plan", "nope"] },
          { id: "full", label: "Shadow", format: "json", sections: [] },
          { id: "custom-2", label: "", format: "json", sections: [] },
          { id: "custom-3", label: "Zip", format: "zip", sections: [] },
          "junk",
        ],
      }),
    );

    expect(options.format).toBe("json");
    expect(options.sections).toEqual(["conversation"]);
    expect(options.activePreset).toBeNull();
    expect(options.contentDetail).toEqual({
      includeSubagentInternals: true,
      includeToolDetails: false,
      includeFullToolResults: false,
    });
    expect(options.redaction).toEqual({
      anonymizePaths: false,
      stripSecrets: false,
      stripPii: true,
    });
    expect(options.customPresets.map((p) => [p.id, p.sections])).toEqual([["custom-1", ["plan"]]]);
  });

  it("falls back to the defaults when the stored copy is unreadable", () => {
    localStorage.setItem(STORAGE_KEYS.exportOptions, "{not json");

    const config = useExportConfig();

    expect(config.format.value).toBe("json");
    expect(config.activePreset.value).toBe("full");
    expect(config.sectionsArray.value).toEqual([...ALL_SECTION_IDS]);
    expect(config.customPresets.value).toEqual([]);
  });
});
