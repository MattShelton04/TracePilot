import { getSourceFormatDiagnostics } from "@tracepilot/client";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsClaudeCodeDiagnostics from "@/components/settings/SettingsClaudeCodeDiagnostics.vue";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({ getSourceFormatDiagnostics: vi.fn() });
});

enableAutoUnmount(afterEach);

const diagnostics = {
  sessions: 3,
  unmappedRecordTypes: [{ name: "brand-new-record", sessions: 1, records: 2 }],
  unmappedAttachmentTypes: [],
  versions: [
    { name: "2.1.280", sessions: 2, records: 140 },
    { name: "2.1.300", sessions: 1, records: 12 },
  ],
};

describe("SettingsClaudeCodeDiagnostics", () => {
  beforeEach(() => {
    vi.mocked(getSourceFormatDiagnostics).mockReset();
  });

  it("lists what indexing recorded for Claude Code, with counts", async () => {
    vi.mocked(getSourceFormatDiagnostics).mockResolvedValue(diagnostics);
    const wrapper = mount(SettingsClaudeCodeDiagnostics);
    await flushPromises();

    expect(getSourceFormatDiagnostics).toHaveBeenCalledWith("claudeCode");
    expect(wrapper.text()).toContain("3 indexed sessions");
    const records = wrapper.get('table[aria-label="Unmapped record types"]');
    expect(records.findAll("tbody tr").map((row) => row.text())).toEqual([
      expect.stringMatching(/brand-new-record\s*1\s*2/),
    ]);
    expect(wrapper.find('table[aria-label="Unmapped attachment types"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("Every attachment type is known");
    const versions = wrapper.get('table[aria-label="Claude Code versions"]');
    expect(versions.findAll("tbody tr td:first-child").map((cell) => cell.text())).toEqual([
      "2.1.280",
      "2.1.300",
    ]);
  });

  it("reports a failed load and retries on refresh", async () => {
    vi.mocked(getSourceFormatDiagnostics)
      .mockRejectedValueOnce(new Error("index unavailable"))
      .mockResolvedValueOnce(diagnostics);
    const wrapper = mount(SettingsClaudeCodeDiagnostics);
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("index unavailable");

    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(getSourceFormatDiagnostics).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("brand-new-record");
  });
});
