import type { FileCheckpoint } from "@tracepilot/client";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import FileHistoryPanel from "../FileHistoryPanel.vue";

const { getSessionFileVersion } = vi.hoisted(() => ({ getSessionFileVersion: vi.fn() }));
vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../../__tests__/mocks/client");
  return createClientMock({ getSessionFileVersion });
});

const checkpoints: FileCheckpoint[] = [
  {
    number: 1,
    messageId: "m1",
    timestamp: "2026-03-14T09:30:00.000Z",
    prompt: "Add a retry to the upload client.",
    files: [{ path: "src/upload.ts", backup: "aaaa@v1", version: 1, changed: true }],
  },
  {
    number: 2,
    messageId: "m2",
    timestamp: null,
    prompt: null,
    files: [
      { path: "src/new.ts", backup: null, version: 1, changed: true },
      { path: "src/upload.ts", backup: "aaaa@v2", version: 2, changed: true },
    ],
  },
];

beforeEach(() => {
  getSessionFileVersion.mockReset();
});

function mountPanel() {
  return mount(FileHistoryPanel, { props: { checkpoints, sessionId: "s1" } });
}

it("lists rewind points without reading any backup", async () => {
  const wrapper = mountPanel();
  expect(wrapper.text()).toContain("Checkpoints (2)");
  expect(wrapper.text()).toContain("Add a retry to the upload client.");
  // A checkpoint whose prompt is gone is named by its position.
  expect(wrapper.text()).toContain("Before prompt 2");
  expect(wrapper.text()).toContain("never restores");

  await wrapper.find("button.fh-toggle-all").trigger("click");
  const rows = wrapper.findAll('[data-testid="file-history-file"]');
  expect(rows).toHaveLength(3);
  expect(rows[1].text()).toContain("Not created yet");
  // A file that did not exist yet has no version to open.
  expect(rows[1].find("button").exists()).toBe(false);
  expect(getSessionFileVersion).not.toHaveBeenCalled();
  wrapper.unmount();
});

it("reads one version only when it is opened, and hides it again", async () => {
  getSessionFileVersion.mockResolvedValue({
    content: "export const retries = 3;\n",
    binary: false,
    truncated: false,
  });
  const wrapper = mountPanel();
  await wrapper.find("button.fh-toggle-all").trigger("click");
  const view = () => wrapper.findAll("button.fh-view")[1];
  await view().trigger("click");
  await flushPromises();
  expect(getSessionFileVersion).toHaveBeenCalledWith("s1", "aaaa@v2");
  expect(wrapper.find(".fh-viewer").text()).toContain("export const retries = 3;");
  expect(view().text()).toBe("Hide");

  await view().trigger("click");
  expect(wrapper.find(".fh-viewer").exists()).toBe(false);
  expect(getSessionFileVersion).toHaveBeenCalledTimes(1);
  wrapper.unmount();
});

it("reports a binary or unavailable version instead of its content", async () => {
  getSessionFileVersion.mockResolvedValueOnce({ content: "", binary: true, truncated: false });
  getSessionFileVersion.mockRejectedValueOnce(new Error("This file version is not available"));
  const wrapper = mountPanel();
  await wrapper.find("button.fh-toggle-all").trigger("click");
  await wrapper.findAll("button.fh-view")[0].trigger("click");
  await flushPromises();
  expect(wrapper.find(".fh-viewer").text()).toContain("Binary file");

  await wrapper.findAll("button.fh-view")[1].trigger("click");
  await flushPromises();
  expect(wrapper.find(".fh-viewer").text()).toContain("not available");
  wrapper.unmount();
});
