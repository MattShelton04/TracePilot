import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick } from "vue";
import { useTheme } from "../useTheme";

type MatchHandler = (e: MediaQueryListEvent) => void;

function mockMatchMedia(initialDark: boolean) {
  let handler: MatchHandler | null = null;
  const mql = {
    matches: initialDark,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_evt: string, cb: MatchHandler) => {
      handler = cb;
    },
    removeEventListener: () => {
      handler = null;
    },
    dispatchEvent: () => true,
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => mql),
  );
  // Also attach to window explicitly.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      mql.media = query;
      return mql;
    },
  });
  return {
    mql,
    fireChange(dark: boolean) {
      mql.matches = dark;
      handler?.({ matches: dark, media: mql.media } as MediaQueryListEvent);
    },
  };
}

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to system and resolves from prefers-color-scheme", () => {
    mockMatchMedia(true);
    const scope = effectScope();
    let api!: ReturnType<typeof useTheme>;
    scope.run(() => {
      api = useTheme();
    });
    expect(api.theme.value).toBe("system");
    expect(api.effectiveTheme.value).toBe("dark");
    expect(api.isSystem.value).toBe(true);
    scope.stop();
  });

  it("hydrates from localStorage", () => {
    localStorage.setItem("tracepilot-theme", JSON.stringify("light"));
    mockMatchMedia(true);
    const scope = effectScope();
    let api!: ReturnType<typeof useTheme>;
    scope.run(() => {
      api = useTheme();
    });
    expect(api.theme.value).toBe("light");
    expect(api.effectiveTheme.value).toBe("light");
    scope.stop();
  });

  it("rejects invalid stored values and falls back to default", () => {
    localStorage.setItem("tracepilot-theme", JSON.stringify("sepia"));
    mockMatchMedia(false);
    const scope = effectScope();
    let api!: ReturnType<typeof useTheme>;
    scope.run(() => {
      api = useTheme({ defaultTheme: "dark" });
    });
    expect(api.theme.value).toBe("dark");
    scope.stop();
  });

  it("setTheme persists and ignores invalid values", async () => {
    mockMatchMedia(false);
    const scope = effectScope();
    let api!: ReturnType<typeof useTheme>;
    scope.run(() => {
      api = useTheme();
    });
    api.setTheme("dark");
    await nextTick();
    expect(api.theme.value).toBe("dark");
    expect(localStorage.getItem("tracepilot-theme")).toBe(JSON.stringify("dark"));

    api.setTheme("sepia" as unknown as "dark");
    expect(api.theme.value).toBe("dark");
    scope.stop();
  });

  it("applies effective theme to documentElement data-theme attribute", async () => {
    mockMatchMedia(false);
    const scope = effectScope();
    let api!: ReturnType<typeof useTheme>;
    scope.run(() => {
      api = useTheme();
    });
    await nextTick();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    api.setTheme("dark");
    await nextTick();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    scope.stop();
  });

  it("reacts to prefers-color-scheme changes when in system mode", async () => {
    const mm = mockMatchMedia(false);
    const scope = effectScope();
    let api!: ReturnType<typeof useTheme>;
    scope.run(() => {
      api = useTheme();
    });
    expect(api.effectiveTheme.value).toBe("light");
    mm.fireChange(true);
    await nextTick();
    expect(api.effectiveTheme.value).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    scope.stop();
  });

  it("skips DOM side-effect when applyToDocument=false", async () => {
    mockMatchMedia(false);
    document.documentElement.setAttribute("data-theme", "sentinel");
    const scope = effectScope();
    scope.run(() => {
      useTheme({ applyToDocument: false });
    });
    await nextTick();
    expect(document.documentElement.getAttribute("data-theme")).toBe("sentinel");
    scope.stop();
  });
});
