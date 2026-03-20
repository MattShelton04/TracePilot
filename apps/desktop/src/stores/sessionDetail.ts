import { defineStore } from "pinia";
import { ref } from "vue";
import type {
  SessionDetail,
  ConversationTurn,
  EventsResponse,
  TodosResponse,
  CheckpointEntry,
  ShutdownMetrics,
  SessionIncident,
} from "@tracepilot/types";
import {
  getSessionDetail,
  getSessionTurns,
  getSessionEvents,
  getSessionTodos,
  getSessionCheckpoints,
  getShutdownMetrics,
  getSessionIncidents,
} from "@tracepilot/client";

export const useSessionDetailStore = defineStore("sessionDetail", () => {
  const sessionId = ref<string | null>(null);
  const detail = ref<SessionDetail | null>(null);
  const turns = ref<ConversationTurn[]>([]);
  const events = ref<EventsResponse | null>(null);
  const todos = ref<TodosResponse | null>(null);
  const checkpoints = ref<CheckpointEntry[]>([]);
  const shutdownMetrics = ref<ShutdownMetrics | null>(null);
  const incidents = ref<SessionIncident[]>([]);

  const loading = ref(false);
  const error = ref<string | null>(null);
  const loaded = ref<Set<string>>(new Set());

  // Guard against stale async responses when user switches sessions quickly
  let requestToken = 0;

  async function loadDetail(id: string) {
    if (sessionId.value === id && loaded.value.has("detail")) {
      return;
    }

    const token = ++requestToken;
    sessionId.value = id;
    loading.value = true;
    error.value = null;
    detail.value = null;
    loaded.value.clear();
    turns.value = [];
    events.value = null;
    todos.value = null;
    checkpoints.value = [];
    shutdownMetrics.value = null;
    incidents.value = [];

    try {
      const result = await getSessionDetail(id);
      if (requestToken !== token) return;
      detail.value = result;
      loaded.value.add("detail");
    } catch (e) {
      if (requestToken !== token) return;
      detail.value = null;
      error.value = String(e);
    } finally {
      if (requestToken === token) loading.value = false;
    }
  }

  async function loadTurns() {
    const id = sessionId.value;
    if (!id || loaded.value.has("turns")) return;
    const token = requestToken;

    try {
      const result = await getSessionTurns(id);
      if (requestToken !== token) return;
      turns.value = result;
      loaded.value.add("turns");
    } catch (e) {
      if (requestToken !== token) return;
      console.error("Failed to load turns:", e);
    }
  }

  async function loadEvents(offset = 0, limit = 100) {
    const id = sessionId.value;
    if (!id) return;
    const token = requestToken;

    try {
      const result = await getSessionEvents(id, offset, limit);
      if (requestToken !== token) return;
      events.value = result;
      loaded.value.add("events");
    } catch (e) {
      if (requestToken !== token) return;
      console.error("Failed to load events:", e);
    }
  }

  async function loadTodos() {
    const id = sessionId.value;
    if (!id || loaded.value.has("todos")) return;
    const token = requestToken;

    try {
      const result = await getSessionTodos(id);
      if (requestToken !== token) return;
      todos.value = result;
      loaded.value.add("todos");
    } catch (e) {
      if (requestToken !== token) return;
      console.error("Failed to load todos:", e);
    }
  }

  async function loadCheckpoints() {
    const id = sessionId.value;
    if (!id || loaded.value.has("checkpoints")) return;
    const token = requestToken;

    try {
      const result = await getSessionCheckpoints(id);
      if (requestToken !== token) return;
      checkpoints.value = result;
      loaded.value.add("checkpoints");
    } catch (e) {
      if (requestToken !== token) return;
      console.error("Failed to load checkpoints:", e);
    }
  }

  async function loadShutdownMetrics() {
    const id = sessionId.value;
    if (!id || loaded.value.has("metrics")) return;
    const token = requestToken;

    try {
      const result = await getShutdownMetrics(id);
      if (requestToken !== token) return;
      shutdownMetrics.value = result;
      loaded.value.add("metrics");
    } catch (e) {
      if (requestToken !== token) return;
      console.error("Failed to load metrics:", e);
    }
  }

  async function loadIncidents() {
    const id = sessionId.value;
    if (!id || loaded.value.has("incidents")) return;
    const token = requestToken;

    try {
      const result = await getSessionIncidents(id);
      if (requestToken !== token) return;
      incidents.value = result;
      loaded.value.add("incidents");
    } catch (e) {
      if (requestToken !== token) return;
      console.warn("Failed to load incidents:", e);
    }
  }

  function reset() {
    sessionId.value = null;
    detail.value = null;
    turns.value = [];
    events.value = null;
    todos.value = null;
    checkpoints.value = [];
    shutdownMetrics.value = null;
    incidents.value = [];
    loaded.value.clear();
    loading.value = false;
    error.value = null;
  }

  /**
   * Soft-refresh all previously loaded sections without clearing existing data.
   * Preserves UI state (selections, scroll, pagination) by not resetting refs.
   */
  async function refreshAll() {
    const id = sessionId.value;
    if (!id) return;
    const token = requestToken;
    const sections = new Set(loaded.value);

    const promises: Promise<void>[] = [];

    if (sections.has("detail")) {
      promises.push(
        getSessionDetail(id).then((result) => {
          if (requestToken !== token) return;
          detail.value = result;
        }).catch((e) => {
          if (requestToken !== token) return;
          console.error("Failed to refresh detail:", e);
        })
      );
    }

    if (sections.has("turns")) {
      promises.push(
        getSessionTurns(id).then((result) => {
          if (requestToken !== token) return;
          turns.value = result;
        }).catch((e) => {
          if (requestToken !== token) return;
          console.error("Failed to refresh turns:", e);
        })
      );
    }

    // Events are intentionally skipped — the EventsTab manages its own pagination
    // state (currentPage, pageSize). Refreshing here would overwrite the user's
    // current page position.

    if (sections.has("todos")) {
      promises.push(
        getSessionTodos(id).then((result) => {
          if (requestToken !== token) return;
          todos.value = result;
        }).catch((e) => {
          if (requestToken !== token) return;
          console.error("Failed to refresh todos:", e);
        })
      );
    }

    if (sections.has("checkpoints")) {
      promises.push(
        getSessionCheckpoints(id).then((result) => {
          if (requestToken !== token) return;
          checkpoints.value = result;
        }).catch((e) => {
          if (requestToken !== token) return;
          console.error("Failed to refresh checkpoints:", e);
        })
      );
    }

    if (sections.has("metrics")) {
      promises.push(
        getShutdownMetrics(id).then((result) => {
          if (requestToken !== token) return;
          shutdownMetrics.value = result;
        }).catch((e) => {
          if (requestToken !== token) return;
          console.error("Failed to refresh metrics:", e);
        })
      );
    }

    if (sections.has("incidents")) {
      promises.push(
        getSessionIncidents(id).then((result) => {
          if (requestToken !== token) return;
          incidents.value = result;
        }).catch((e) => {
          if (requestToken !== token) return;
          console.warn("Failed to refresh incidents:", e);
        })
      );
    }

    await Promise.allSettled(promises);
  }

  return {
    sessionId,
    detail,
    turns,
    events,
    todos,
    checkpoints,
    shutdownMetrics,
    incidents,
    loading,
    error,
    loaded,
    loadDetail,
    loadTurns,
    loadEvents,
    loadTodos,
    loadCheckpoints,
    loadShutdownMetrics,
    loadIncidents,
    reset,
    refreshAll,
  };
});
