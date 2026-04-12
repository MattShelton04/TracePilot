import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openExternal, sanitizeExternalUrl } from "../../utils/openExternal";
import * as logger from "../../utils/logger";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
const openUrlMock = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

describe("sanitizeExternalUrl", () => {
  it("allows http/https URLs", () => {
    expect(sanitizeExternalUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(sanitizeExternalUrl("http://example.com")).toBe("http://example.com/");
  });

  it("normalizes protocol case and trims whitespace", () => {
    expect(sanitizeExternalUrl("  HTTPS://Example.com  ")).toBe("https://example.com/");
  });

  it("rejects unsupported protocols", () => {
    expect(sanitizeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeExternalUrl("ftp://example.com/file")).toBeNull();
    expect(sanitizeExternalUrl("data:text/html,hi")).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(sanitizeExternalUrl("not a url")).toBeNull();
  });
});

describe("openExternal", () => {
  const originalOpen = window.open;
  const warnSpy = vi.spyOn(logger, "logWarn");

  beforeEach(() => {
    window.open = vi.fn();
    warnSpy.mockClear();
    openUrlMock.mockClear();
  });

  afterEach(() => {
    window.open = originalOpen;
  });

  it("opens allowed URLs with browser fallback when not in Tauri", async () => {
    await openExternal("https://example.com/page");
    expect(window.open).toHaveBeenCalledWith(
      "https://example.com/page",
      "_blank",
      "noopener",
    );
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("blocks javascript: URLs", async () => {
    await openExternal("javascript:alert(1)");
    expect(window.open).not.toHaveBeenCalled();
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[openExternal] Blocked unsafe external URL",
      { url: "javascript:alert(1)" },
    );
  });

  it("blocks unsupported protocols", async () => {
    await openExternal("ftp://example.com/file");
    expect(window.open).not.toHaveBeenCalled();
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[openExternal] Blocked unsafe external URL",
      { url: "ftp://example.com/file" },
    );
  });

  it("blocks malformed URLs", async () => {
    await openExternal("not a url");
    expect(window.open).not.toHaveBeenCalled();
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[openExternal] Blocked unsafe external URL",
      { url: "not a url" },
    );
  });

  it("blocks data URLs", async () => {
    await openExternal("data:text/html,hi");
    expect(window.open).not.toHaveBeenCalled();
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[openExternal] Blocked unsafe external URL",
      { url: "data:text/html,hi" },
    );
  });
});
