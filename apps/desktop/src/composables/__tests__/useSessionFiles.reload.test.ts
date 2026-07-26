import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

const mockSessionListFiles = vi.fn();
const mockSessionReadFile = vi.fn();
const mockSessionReadImagePreview = vi.fn();
const mockSessionReadSqlite = vi.fn();

vi.mock("@tracepilot/client", () => ({
  sessionListFiles: (...args: unknown[]) => mockSessionListFiles(...args),
  sessionReadFile: (...args: unknown[]) => mockSessionReadFile(...args),
  sessionReadImagePreview: (...args: unknown[]) => mockSessionReadImagePreview(...args),
  sessionReadSqlite: (...args: unknown[]) => mockSessionReadSqlite(...args),
}));

import { useSessionFiles } from "../useSessionFiles";

function mountComposable(sessionId: string) {
  let instance!: ReturnType<typeof useSessionFiles>;
  const Host = defineComponent({
    setup() {
      instance = useSessionFiles(() => sessionId);
      return () => h("div");
    },
  });
  const wrapper = mount(Host);
  return { wrapper, instance };
}

describe("useSessionFiles reload and cache behavior", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reload re-fetches files for the current session", async () => {
    const initialEntries = [
      {
        path: "plan.md",
        name: "plan.md",
        sizeBytes: 200,
        isDirectory: false,
        fileType: "markdown",
      },
    ];
    const reloadedEntries = [
      {
        path: "plan.md",
        name: "plan.md",
        sizeBytes: 300,
        isDirectory: false,
        fileType: "markdown",
      },
      {
        path: "notes.md",
        name: "notes.md",
        sizeBytes: 100,
        isDirectory: false,
        fileType: "markdown",
      },
    ];
    mockSessionListFiles
      .mockResolvedValueOnce(initialEntries)
      .mockResolvedValueOnce(reloadedEntries);

    const { instance } = mountComposable("test-session-id");
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(instance.files).toEqual(initialEntries);

    await instance.reload();

    expect(instance.files).toEqual(reloadedEntries);
    expect(mockSessionListFiles).toHaveBeenCalledTimes(2);
  });

  it("silent reload does not toggle filesLoading and flags newly-added paths", async () => {
    const first = [
      { path: "a.md", name: "a.md", sizeBytes: 1, isDirectory: false, fileType: "markdown" },
    ];
    const second = [
      { path: "a.md", name: "a.md", sizeBytes: 1, isDirectory: false, fileType: "markdown" },
      { path: "b.md", name: "b.md", sizeBytes: 2, isDirectory: false, fileType: "markdown" },
    ];
    mockSessionListFiles.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const { instance } = mountComposable("sess-1");
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    let sawLoading = false;
    const reloadPromise = instance.reload();
    if (instance.filesLoading) sawLoading = true;
    await reloadPromise;

    expect(sawLoading).toBe(false);
    expect(instance.filesLoading).toBe(false);
    expect(instance.files).toEqual(second);
    expect(Array.from(instance.newFilePaths)).toEqual(["b.md"]);

    instance.ackNewPaths();
    expect(instance.newFilePaths.size).toBe(0);
  });

  it("silent reload refetches open file content and records contentChangedAt", async () => {
    const entries = [
      {
        path: "plan.md",
        name: "plan.md",
        sizeBytes: 10,
        isDirectory: false,
        fileType: "markdown",
      },
    ];
    mockSessionListFiles.mockResolvedValue(entries);
    mockSessionReadFile
      .mockResolvedValueOnce("v1")
      .mockResolvedValueOnce("v2")
      .mockResolvedValueOnce("v2");

    const { instance } = mountComposable("sess-1");
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    await instance.selectFile("plan.md", "markdown");
    expect(instance.fileContent).toBe("v1");
    expect(instance.contentChangedAt).toBeNull();

    await instance.reload();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(instance.fileContent).toBe("v2");
    expect(instance.contentChangedAt).not.toBeNull();

    instance.ackContentChanged();
    expect(instance.contentChangedAt).toBeNull();

    await instance.reload();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(instance.contentChangedAt).toBeNull();
  });

  it("reuses a bounded text page when switching back to a recently viewed file", async () => {
    mockSessionListFiles.mockResolvedValue([
      { path: "a.txt", name: "a.txt", sizeBytes: 1, isDirectory: false, fileType: "text" },
      { path: "b.txt", name: "b.txt", sizeBytes: 1, isDirectory: false, fileType: "text" },
    ]);
    mockSessionReadFile.mockResolvedValueOnce("a").mockResolvedValueOnce("b");

    const { instance } = mountComposable("sess-cache");
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    await instance.selectFile("a.txt", "text");
    await instance.selectFile("b.txt", "text");
    await instance.selectFile("a.txt", "text");

    expect(instance.fileContent).toBe("a");
    expect(mockSessionReadFile).toHaveBeenCalledTimes(2);
  });

  it("resets filesLoading when non-silent reload is superseded by another reload", async () => {
    mockSessionListFiles.mockResolvedValue([]);
    const { instance } = mountComposable("sess-supersede");
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const manualPromise = instance.reload({ silent: false });
    expect(instance.filesLoading).toBe(true);

    const silentPromise = instance.reload({ silent: true });

    await Promise.all([manualPromise, silentPromise]);
    expect(instance.filesLoading).toBe(false);
  });
});
