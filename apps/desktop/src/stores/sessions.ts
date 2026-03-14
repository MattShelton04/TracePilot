import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { SessionListItem } from "@tracepilot/types";
import { listSessions } from "@tracepilot/client";

export const useSessionsStore = defineStore("sessions", () => {
  const sessions = ref<SessionListItem[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const searchQuery = ref("");
  const filterRepo = ref<string | null>(null);
  const filterBranch = ref<string | null>(null);
  const sortBy = ref<"updated" | "created" | "events">("updated");

  const filteredSessions = computed(() => {
    let result = sessions.value;
    if (filterRepo.value) {
      result = result.filter((s) => s.repository === filterRepo.value);
    }
    if (filterBranch.value) {
      result = result.filter((s) => s.branch === filterBranch.value);
    }
    return result;
  });

  const repositories = computed(() => {
    const repos = new Set(sessions.value.map((s) => s.repository).filter(Boolean));
    return [...repos].sort();
  });

  const branches = computed(() => {
    const br = new Set(sessions.value.map((s) => s.branch).filter(Boolean));
    return [...br].sort();
  });

  async function fetchSessions() {
    loading.value = true;
    error.value = null;
    try {
      sessions.value = await listSessions();
    } catch (e) {
      error.value = String(e);
    } finally {
      loading.value = false;
    }
  }

  return {
    sessions,
    loading,
    error,
    searchQuery,
    filterRepo,
    filterBranch,
    sortBy,
    filteredSessions,
    repositories,
    branches,
    fetchSessions,
  };
});
