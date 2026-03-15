import { defineStore } from "pinia";
import { ref, watch } from "vue";

export type ThemeOption = "dark" | "light" | "system";

function applyTheme(theme: ThemeOption) {
  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export const usePreferencesStore = defineStore("preferences", () => {
  const theme = ref<ThemeOption>("dark");
  const lastViewedSession = ref<string | null>(null);
  let mediaQuery: MediaQueryList | null = null;
  let mediaHandler: ((e: MediaQueryListEvent) => void) | null = null;

  // Persist to localStorage
  function load() {
    try {
      const saved = localStorage.getItem("tracepilot-prefs");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.theme) theme.value = parsed.theme;
        if (parsed.lastViewedSession) lastViewedSession.value = parsed.lastViewedSession;
      }
    } catch { /* ignore */ }
  }

  function save() {
    localStorage.setItem(
      "tracepilot-prefs",
      JSON.stringify({ theme: theme.value, lastViewedSession: lastViewedSession.value })
    );
  }

  function setupSystemThemeListener() {
    // Clean up previous listener
    if (mediaQuery && mediaHandler) {
      mediaQuery.removeEventListener("change", mediaHandler);
      mediaHandler = null;
    }

    if (theme.value === "system") {
      mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      mediaHandler = () => applyTheme("system");
      mediaQuery.addEventListener("change", mediaHandler);
    }
  }

  load();

  // Watch theme changes: update DOM and manage system listener
  watch(theme, (newTheme) => {
    applyTheme(newTheme);
    setupSystemThemeListener();
  }, { immediate: true });

  watch([theme, lastViewedSession], save, { deep: true });

  return { theme, lastViewedSession, applyTheme: () => applyTheme(theme.value) };
});
