import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.fn<(url: string) => Promise<void>>();
const showError = vi.fn();
const showWarning = vi.fn();

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("@tracepilot/ui", () => ({
  useToast: () => ({ error: showError, warning: showWarning }),
}));
vi.mock("@/utils/logger", () => ({ logWarn: vi.fn() }));

function setTauri(enabled: boolean) {
  if (enabled) {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  } else {
    // @ts-expect-error test-only Tauri global
    delete window.__TAURI_INTERNALS__;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  openUrl.mockResolvedValue(undefined);
  setTauri(false);
});

afterEach(() => {
  setTauri(false);
});

describe("parseExternalUrl", () => {
  it("accepts ordinary HTTP and HTTPS URLs", async () => {
    const { parseExternalUrl } = await import("@/utils/openExternal");
    expect(parseExternalUrl("https://example.com/docs")?.href).toBe("https://example.com/docs");
    expect(parseExternalUrl("http://example.com/")?.href).toBe("http://example.com/");
  });

  it.each([
    "not a url",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://localhost/admin",
    "http://service.localhost/",
    "http://127.0.0.42/",
    "http://[::1]/",
    "http://0.0.0.0/",
  ])("rejects unsupported or local URL %s", async (url) => {
    const { parseExternalUrl } = await import("@/utils/openExternal");
    expect(parseExternalUrl(url)).toBeNull();
  });
});

describe("openExternal", () => {
  it("uses the Tauri opener for a valid external URL", async () => {
    setTauri(true);
    const { openExternal } = await import("@/utils/openExternal");

    await openExternal("https://example.com/docs");

    expect(openUrl).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("does not use a browser fallback when Tauri denies a URL", async () => {
    setTauri(true);
    openUrl.mockRejectedValueOnce(new Error("not allowed"));
    const browserOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    const { openExternal } = await import("@/utils/openExternal");

    await openExternal("https://example.com/");

    expect(browserOpen).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(
      "Could not open link",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("warns instead of opening an unsafe URL", async () => {
    const browserOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    const { openExternal } = await import("@/utils/openExternal");

    await openExternal("javascript:alert(1)");

    expect(openUrl).not.toHaveBeenCalled();
    expect(browserOpen).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalledWith(
      "Link blocked",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });
});
