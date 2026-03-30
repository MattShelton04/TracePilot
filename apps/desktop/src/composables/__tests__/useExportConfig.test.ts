import { describe, expect, it } from "vitest";
import { nextTick } from "vue";

import { EXPORT_PRESETS, useExportConfig } from "../useExportConfig";

describe("useExportConfig", () => {
  it("keeps activePreset when applying a preset", async () => {
    const config = useExportConfig();

    config.applyPreset("summary");
    await nextTick();

    const summaryPreset = EXPORT_PRESETS.find((p) => p.id === "summary");
    expect(config.activePreset.value).toBe("summary");
    expect(config.format.value).toBe(summaryPreset?.format);
    expect(new Set(config.sectionsArray.value)).toEqual(new Set(summaryPreset?.sections ?? []));
  });

  it("clears activePreset when format changes manually", async () => {
    const config = useExportConfig();

    config.applyPreset("full");
    await nextTick();

    config.format.value = "csv";
    await nextTick();

    expect(config.activePreset.value).toBeNull();
  });
});
