import type { PromptVariable, SessionListItem, TaskPreset } from "@tracepilot/types";
import { useToast } from "@tracepilot/ui";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usePresetsStore } from "@/stores/presets";
import { useSessionsStore } from "@/stores/sessions";
import { useTasksStore } from "@/stores/tasks";

/**
 * Wizard state machine + validation for the three-step "Create Task" flow.
 *
 * Extracted from `views/tasks/TaskCreateView.vue` in Wave 22. All refs, computeds
 * and store calls preserve the original semantics byte-for-byte; the view is a
 * thin shell that delegates to this composable and renders the step components.
 */

export const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
] as const;

export const WIZARD_STEPS = [
  { number: 1, label: "Select Preset" },
  { number: 2, label: "Configure" },
  { number: 3, label: "Review & Submit" },
] as const;

export type CategoryFilter = "all" | "builtin" | "custom";

/** Get today's date as YYYY-MM-DD. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Get this week's Monday as YYYY-MM-DD. */
function thisWeekMondayISO(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

export function useTaskWizard() {
  const route = useRoute();
  const router = useRouter();
  const presetsStore = usePresetsStore();
  const tasksStore = useTasksStore();
  const sessionsStore = useSessionsStore();
  const { success: toastSuccess, error: toastError } = useToast();

  // ── Wizard state ────────────────────────────────────────────────────
  const currentStep = ref(1);
  const highestStep = ref(1);
  const selectedPreset = ref<TaskPreset | null>(null);
  const searchQuery = ref("");
  const submitting = ref(false);
  const categoryFilter = ref<CategoryFilter>("all");
  const sessionSearchQuery = reactive<Record<string, string>>({});
  const sessionSearchResults = reactive<Record<string, SessionListItem[]>>({});
  const promptTemplateExpanded = ref(false);
  const formValues = reactive<Record<string, string | number | boolean | null>>({});
  const priority = ref("normal");
  const maxRetries = ref(3);

  // ── Computed ────────────────────────────────────────────────────────
  const filteredPresets = computed(() => {
    let list = presetsStore.enabledPresets;
    if (categoryFilter.value === "builtin") {
      list = list.filter((p) => p.builtin);
    } else if (categoryFilter.value === "custom") {
      list = list.filter((p) => !p.builtin);
    }
    const q = searchQuery.value.toLowerCase().trim();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)),
    );
  });

  const variables = computed<PromptVariable[]>(
    () => selectedPreset.value?.prompt.variables ?? [],
  );

  const contextSourcesCount = (preset: TaskPreset): number => preset.context.sources.length;

  const allRequiredFilled = computed(() => {
    for (const v of variables.value) {
      if (!v.required) continue;
      const val = formValues[v.name];
      if (val === undefined || val === null || val === "") return false;
    }
    return true;
  });

  const canAdvanceStep1 = computed(() => !!selectedPreset.value);
  const canAdvanceStep2 = computed(() => allRequiredFilled.value);

  const contextSummary = computed(() => {
    if (!selectedPreset.value) return "";
    const sources = selectedPreset.value.context.sources;
    const count = sources.length;
    if (count === 0) return "No context sources configured.";
    const types = [...new Set(sources.map((s) => s.type))].join(", ");
    return `This task will use ${count} context source${count !== 1 ? "s" : ""} (${types}).`;
  });

  const estimatedTokenBudget = computed(() => {
    if (!selectedPreset.value) return null;
    const maxChars = selectedPreset.value.context.maxChars;
    if (!maxChars || maxChars <= 0) return null;
    return Math.round(maxChars / 4);
  });

  const presetsLoading = computed(() => presetsStore.loading);
  const presetsError = computed(() => presetsStore.error);

  // ── Actions ─────────────────────────────────────────────────────────
  function selectPreset(preset: TaskPreset) {
    selectedPreset.value = preset;

    const newValues: Record<string, string | number | boolean> = {};
    for (const v of preset.prompt.variables) {
      if (v.type === "boolean") {
        newValues[v.name] = v.default === "true";
      } else if (v.type === "number") {
        newValues[v.name] = v.default != null ? Number(v.default) : 0;
      } else if (v.type === "date") {
        if (v.default) {
          newValues[v.name] = v.default;
        } else if (v.name.includes("week")) {
          newValues[v.name] = thisWeekMondayISO();
        } else {
          newValues[v.name] = todayISO();
        }
      } else {
        newValues[v.name] = v.default ?? "";
      }
    }
    for (const k of Object.keys(formValues)) delete formValues[k];
    Object.assign(formValues, newValues);

    priority.value = preset.execution.priority || "normal";
    maxRetries.value = preset.execution.maxRetries ?? 3;
  }

  function goBack() {
    if (currentStep.value > 1) {
      currentStep.value -= 1;
    } else {
      router.back();
    }
  }

  function goNext() {
    if (currentStep.value === 1 && selectedPreset.value) {
      currentStep.value = 2;
      highestStep.value = Math.max(highestStep.value, 2);
    } else if (currentStep.value === 2 && canAdvanceStep2.value) {
      currentStep.value = 3;
      highestStep.value = Math.max(highestStep.value, 3);
    }
  }

  function goToStep(step: number) {
    if (step <= highestStep.value && step < currentStep.value) {
      currentStep.value = step;
    }
  }

  async function handleSubmit(navigateToDetail = false) {
    if (!selectedPreset.value || submitting.value) return;
    submitting.value = true;

    const inputParams: Record<string, unknown> = { ...formValues };
    try {
      const task = await tasksStore.createTask(
        selectedPreset.value.taskType || selectedPreset.value.id,
        selectedPreset.value.id,
        inputParams,
        priority.value,
        maxRetries.value,
      );

      if (task) {
        toastSuccess("Task created successfully", { duration: 3000 });
        router.push(navigateToDetail ? `/tasks/${task.id}` : "/tasks");
      } else {
        toastError(tasksStore.error ?? "Failed to create task", { duration: 5000 });
      }
    } catch {
      toastError("An unexpected error occurred", { duration: 5000 });
    } finally {
      submitting.value = false;
    }
  }

  function cancelToTasksList() {
    router.push("/tasks");
  }

  function reloadPresets() {
    presetsStore.loadPresets();
  }

  // ── Helpers ─────────────────────────────────────────────────────────
  function formatVariableLabel(name: string): string {
    return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function displayValue(variable: PromptVariable): string {
    const val = formValues[variable.name];
    if (val === undefined || val === null || val === "") return "—";
    if (variable.type === "boolean") return val ? "Yes" : "No";
    return String(val);
  }

  function isSessionVariable(variable: PromptVariable): boolean {
    return variable.type === "session_ref" || variable.name === "session_id";
  }

  function isDateVariable(variable: PromptVariable): boolean {
    return variable.type === "date";
  }

  // ── Session-picker search (debounced local filter) ──────────────────
  let sessionSearchTimer: ReturnType<typeof setTimeout> | null = null;

  function handleSessionSearch(variableName: string, query: string) {
    sessionSearchQuery[variableName] = query;
    if (sessionSearchTimer) clearTimeout(sessionSearchTimer);
    if (!query.trim()) {
      sessionSearchResults[variableName] = [];
      return;
    }
    // Debounce: wait 150ms before filtering to avoid per-keystroke work
    sessionSearchTimer = setTimeout(() => {
      const q = query.toLowerCase();
      sessionSearchResults[variableName] = sessionsStore.sessions
        .filter(
          (s) =>
            (s.summary ?? "").toLowerCase().includes(q) ||
            s.id.toLowerCase().includes(q),
        )
        .slice(0, 20);
    }, 150);
  }

  function selectSession(variableName: string, session: SessionListItem) {
    formValues[variableName] = session.id;
    sessionSearchResults[variableName] = [];
    sessionSearchQuery[variableName] = session.summary ?? session.id;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────
  onMounted(async () => {
    await presetsStore.loadPresets();
    // Pre-load sessions so the session picker can use local data instantly
    if (sessionsStore.sessions.length === 0) sessionsStore.fetchSessions();
    // Auto-select preset if presetId is in query params
    const presetId = route.query.presetId as string | undefined;
    if (presetId) {
      const match = presetsStore.enabledPresets.find((p) => p.id === presetId);
      if (match) {
        selectPreset(match);
        // Skip directly to Configure step when coming from a preset link
        currentStep.value = 2;
        highestStep.value = 2;
      }
    }
  });

  return reactive({
    // state
    currentStep,
    highestStep,
    selectedPreset,
    searchQuery,
    submitting,
    categoryFilter,
    sessionSearchQuery,
    sessionSearchResults,
    promptTemplateExpanded,
    formValues,
    priority,
    maxRetries,
    // computeds
    filteredPresets,
    variables,
    allRequiredFilled,
    canAdvanceStep1,
    canAdvanceStep2,
    contextSummary,
    estimatedTokenBudget,
    presetsLoading,
    presetsError,
    // actions
    selectPreset,
    goBack,
    goNext,
    goToStep,
    handleSubmit,
    handleSessionSearch,
    selectSession,
    cancelToTasksList,
    reloadPresets,
    // helpers
    formatVariableLabel,
    displayValue,
    isSessionVariable,
    isDateVariable,
    contextSourcesCount,
  });
}

export type TaskWizard = ReturnType<typeof useTaskWizard>;
