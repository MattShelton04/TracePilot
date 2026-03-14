import { defineStore } from "pinia";
import { ref, watch } from "vue";

export const usePreferencesStore = defineStore("preferences", () => {
  const theme = ref<"dark" | "light">("dark");
  const lastViewedSession = ref<string | null>(null);

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

  load();
  watch([theme, lastViewedSession], save, { deep: true });

  return { theme, lastViewedSession };
});
