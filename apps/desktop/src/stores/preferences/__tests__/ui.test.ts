import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { applyContentMaxWidth, applyUiScale, BASE_FONT_SIZE_PX, createUiSlice } from "../ui";

describe("createUiSlice", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.fontSize = "";
    document.documentElement.style.removeProperty("--content-max-width");
  });

  it("defaults theme to dark when no cached theme exists", () => {
    const slice = createUiSlice();
    expect(slice.theme.value).toBe("dark");
  });

  it("hydrates theme from the write-through localStorage cache", () => {
    localStorage.setItem(STORAGE_KEYS.theme, "light");
    const slice = createUiSlice();
    expect(slice.theme.value).toBe("light");
  });

  it("ignores an invalid cached theme and falls back to dark", () => {
    localStorage.setItem(STORAGE_KEYS.theme, "sepia");
    const slice = createUiSlice();
    expect(slice.theme.value).toBe("dark");
  });

  it("addRecentRepoPath dedupes, prepends most recent, and caps at 10", () => {
    const slice = createUiSlice();
    for (let i = 0; i < 12; i++) slice.addRecentRepoPath(`/repo-${i}`);
    expect(slice.recentRepoPaths.value.length).toBe(10);
    expect(slice.recentRepoPaths.value[0].endsWith("repo-11")).toBe(true);
    // Re-adding an existing path bumps it to the front without duplicating
    slice.addRecentRepoPath("/repo-5");
    expect(slice.recentRepoPaths.value.filter((p) => p.endsWith("repo-5")).length).toBe(1);
    expect(slice.recentRepoPaths.value[0].endsWith("repo-5")).toBe(true);
  });

  it("applyContentMaxWidth writes 'none' for 0 and 'px' otherwise", () => {
    applyContentMaxWidth(0);
    expect(document.documentElement.style.getPropertyValue("--content-max-width")).toBe("none");
    applyContentMaxWidth(1200);
    expect(document.documentElement.style.getPropertyValue("--content-max-width")).toBe("1200px");
  });

  it("applyUiScale clamps to the 0.8–1.3 safe range", () => {
    applyUiScale(5);
    expect(document.documentElement.style.fontSize).toBe(`${BASE_FONT_SIZE_PX * 1.3}px`);
    applyUiScale(0.1);
    expect(document.documentElement.style.fontSize).toBe(`${BASE_FONT_SIZE_PX * 0.8}px`);
  });
});
