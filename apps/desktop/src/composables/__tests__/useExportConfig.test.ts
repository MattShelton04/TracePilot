import { describe, expect, it } from "vitest";
import { nextTick } from "vue";

import { EXPORT_PRESETS, useExportConfig } from "../useExportConfig";

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

  it("clears activePreset when format changes manually", async () => {
    const config = useExportConfig();

    config.applyPreset("full");
    await nextTick();

    config.format.value = "markdown";
    await nextTick();

    expect(config.activePreset.value).toBeNull();
  });
});
