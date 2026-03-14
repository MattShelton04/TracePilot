import { defineStore } from "pinia";
import { ref } from "vue";
import type {
  SessionDetail,
  ConversationTurn,
  EventsResponse,
  TodosResponse,
  CheckpointEntry,
  ShutdownMetrics,
} from "@tracepilot/types";
import {
  getSessionDetail,
  getSessionTurns,
  getSessionEvents,
  getSessionTodos,
  getSessionCheckpoints,
  getShutdownMetrics,
} from "@tracepilot/client";

export const useSessionDetailStore = defineStore("sessionDetail", () => {
  const sessionId = ref<string | null>(null);
  const detail = ref<SessionDetail | null>(null);
  const turns = ref<ConversationTurn[]>([]);
  const events = ref<EventsResponse | null>(null);
  const todos = ref<TodosResponse | null>(null);
  const checkpoints = ref<CheckpointEntry[]>([]);
  const shutdownMetrics = ref<ShutdownMetrics | null>(null);

  const loading = ref(false);
  const error = ref<string | null>(null);
  const loaded = ref<Set<string>>(new Set());

  async function loadDetail(id: string) {
    if (sessionId.value === id && loaded.value.has("detail")) {
      return;
    }

    sessionId.value = id;
    loading.value = true;
    error.value = null;
    loaded.value.clear();
    turns.value = [];
    events.value = null;
    todos.value = null;
    checkpoints.value = [];
    shutdownMetrics.value = null;

    try {
      detail.value = await getSessionDetail(id);
      loaded.value.add("detail");
    } catch (e) {
      detail.value = null;
      error.value = String(e);
    } finally {
      loading.value = false;
    }
  }

  async function loadTurns() {
    if (!sessionId.value || loaded.value.has("turns")) {
      return;
    }

    try {
      turns.value = await getSessionTurns(sessionId.value);
      loaded.value.add("turns");
    } catch (e) {
      console.error("Failed to load turns:", e);
    }
  }

  async function loadEvents(offset = 0, limit = 100) {
    if (!sessionId.value) {
      return;
    }

    try {
      events.value = await getSessionEvents(sessionId.value, offset, limit);
      loaded.value.add("events");
    } catch (e) {
      console.error("Failed to load events:", e);
    }
  }

  async function loadTodos() {
    if (!sessionId.value || loaded.value.has("todos")) {
      return;
    }

    try {
      todos.value = await getSessionTodos(sessionId.value);
      loaded.value.add("todos");
    } catch (e) {
      console.error("Failed to load todos:", e);
    }
  }

  async function loadCheckpoints() {
    if (!sessionId.value || loaded.value.has("checkpoints")) {
      return;
    }

    try {
      checkpoints.value = await getSessionCheckpoints(sessionId.value);
      loaded.value.add("checkpoints");
    } catch (e) {
      console.error("Failed to load checkpoints:", e);
    }
  }

  async function loadShutdownMetrics() {
    if (!sessionId.value || loaded.value.has("metrics")) {
      return;
    }

    try {
      shutdownMetrics.value = await getShutdownMetrics(sessionId.value);
      loaded.value.add("metrics");
    } catch (e) {
      console.error("Failed to load metrics:", e);
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
    loaded.value.clear();
    loading.value = false;
    error.value = null;
  }

  return {
    sessionId,
    detail,
    turns,
    events,
    todos,
    checkpoints,
    shutdownMetrics,
    loading,
    error,
    loaded,
    loadDetail,
    loadTurns,
    loadEvents,
    loadTodos,
    loadCheckpoints,
    loadShutdownMetrics,
    reset,
  };
});
