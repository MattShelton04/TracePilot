<script setup lang="ts">
import type { PromptVariable, SessionListItem, TaskPreset } from "@tracepilot/types";
import { ErrorState, LoadingSpinner, PageShell, SectionPanel, useToast } from "@tracepilot/ui";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usePresetsStore } from "@/stores/presets";
import { useSessionsStore } from "@/stores/sessions";
import { useTasksStore } from "@/stores/tasks";

const route = useRoute();
const router = useRouter();
const presetsStore = usePresetsStore();
const tasksStore = useTasksStore();
const sessionsStore = useSessionsStore();
const { success: toastSuccess, error: toastError } = useToast();

// ── Wizard state ──────────────────────────────────────────────────────
const currentStep = ref(1);
const selectedPreset = ref<TaskPreset | null>(null);
const searchQuery = ref("");
const submitting = ref(false);
const highestStep = ref(1);
const categoryFilter = ref<"all" | "builtin" | "custom">("all");
const sessionSearchQuery = reactive<Record<string, string>>({});
const sessionSearchResults = reactive<Record<string, SessionListItem[]>>({});
const sessionSearchLoading = reactive<Record<string, boolean>>({});
const promptTemplateExpanded = ref(false);

// Step 2 form state
const formValues = reactive<Record<string, string | number | boolean | null>>({});
const priority = ref("normal");
const maxRetries = ref(3);

// ── Computed ──────────────────────────────────────────────────────────
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

const variables = computed<PromptVariable[]>(() => selectedPreset.value?.prompt.variables ?? []);

const contextSourcesCount = (preset: TaskPreset): number => {
  return preset.context.sources.length;
};

const allRequiredFilled = computed(() => {
  for (const v of variables.value) {
    if (!v.required) continue;
    const val = formValues[v.name];
    if (val === undefined || val === null || val === "") return false;
  }
  return true;
});

const canAdvanceStep2 = computed(() => allRequiredFilled.value);
const canAdvanceStep1 = computed(() => !!selectedPreset.value);

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

const priorityOptions = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
] as const;

const steps = [
  { number: 1, label: "Select Preset" },
  { number: 2, label: "Configure" },
  { number: 3, label: "Review & Submit" },
];

// ── Actions ───────────────────────────────────────────────────────────
function selectPreset(preset: TaskPreset) {
  selectedPreset.value = preset;

  // Reset form with defaults
  const newValues: Record<string, string | number | boolean> = {};
  for (const v of preset.prompt.variables) {
    if (v.type === "boolean") {
      newValues[v.name] = v.default === "true";
    } else if (v.type === "number") {
      newValues[v.name] = v.default != null ? Number(v.default) : 0;
    } else if (v.type === "date") {
      // Smart defaults: "week_start_date" → this Monday, others → today
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

// ── Lifecycle ─────────────────────────────────────────────────────────
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
</script>

<template>
  <PageShell>
    <!-- Header -->
    <div class="wizard-header">
        <button class="back-btn" @click="goBack" title="Go back">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path
              d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75
                 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 1.06L4.56
                 7.25h7.69a.75.75 0 0 1 0 1.5H4.56l3.22 3.22a.75.75
                 0 0 1 0 1.06z"
            />
          </svg>
        </button>
        <h1 class="wizard-title">Create Task</h1>
      </div>

      <!-- Step indicator -->
      <div class="step-indicator">
        <template v-for="(step, idx) in steps" :key="step.number">
          <button
            :class="[
              'step-dot-group',
              {
                active: currentStep === step.number,
                completed: currentStep > step.number,
                clickable: step.number < currentStep && step.number <= highestStep,
              },
            ]"
            :disabled="step.number >= currentStep || step.number > highestStep"
            @click="goToStep(step.number)"
          >
            <div class="step-dot">
              <svg
                v-if="currentStep > step.number"
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path
                  d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25
                     7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75
                     0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75
                     0 0 1 1.06 0z"
                />
              </svg>
              <span v-else>{{ step.number }}</span>
            </div>
            <span class="step-label">{{ step.label }}</span>
          </button>
          <div
            v-if="idx < steps.length - 1"
            :class="['step-connector', { filled: currentStep > step.number }]"
          />
        </template>
      </div>

      <!-- Loading -->
      <div v-if="presetsStore.loading" class="wizard-loading">
        <LoadingSpinner size="md" />
        <span>Loading presets…</span>
      </div>

      <!-- Error -->
      <ErrorState
        v-else-if="presetsStore.error"
        heading="Failed to load presets"
        :message="presetsStore.error"
        @retry="presetsStore.loadPresets()"
      />

      <!-- Step content -->
      <template v-else>
        <!-- Step 1: Select Preset -->
        <Transition name="step-fade" mode="out-in">
          <div v-if="currentStep === 1" key="step-1" class="step-content">
            <div class="search-bar">
              <svg
                class="search-icon"
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path
                  d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9
                     0zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75
                     0 1 1-1.06 1.06l-3.04-3.04z"
                />
              </svg>
              <input
                v-model="searchQuery"
                type="text"
                class="search-input"
                placeholder="Search presets…"
              />
            </div>

            <div class="category-pills">
              <button
                v-for="cat in (['all', 'builtin', 'custom'] as const)"
                :key="cat"
                :class="['category-pill', { active: categoryFilter === cat }]"
                @click="categoryFilter = cat"
              >
                {{ cat === "all" ? "All" : cat === "builtin" ? "Built-in" : "Custom" }}
              </button>
            </div>

            <div v-if="filteredPresets.length === 0" class="empty-state">
              <span class="empty-icon">📋</span>
              <span class="empty-text">
                {{ searchQuery ? "No presets match your search." : "No enabled presets found." }}
              </span>
            </div>

            <div v-else class="preset-grid">
              <button
                v-for="preset in filteredPresets"
                :key="preset.id"
                :class="[
                  'preset-card',
                  { 'preset-card--selected': selectedPreset?.id === preset.id },
                ]"
                @click="selectPreset(preset)"
              >
                <div class="preset-card-header">
                  <span class="preset-name">{{ preset.name }}</span>
                  <span v-if="preset.builtin" class="preset-builtin">built-in</span>
                </div>
                <p class="preset-description">{{ preset.description }}</p>
                <div class="preset-card-footer">
                  <div class="preset-tags">
                    <span v-for="tag in preset.tags.slice(0, 3)" :key="tag" class="preset-tag">
                      {{ tag }}
                    </span>
                    <span v-if="preset.tags.length > 3" class="preset-tag preset-tag--more">
                      +{{ preset.tags.length - 3 }}
                    </span>
                  </div>
                  <span class="preset-meta">
                    {{ preset.prompt.variables.length }} var{{
                      preset.prompt.variables.length !== 1 ? "s" : ""
                    }}
                    · {{ contextSourcesCount(preset) }} source{{
                      contextSourcesCount(preset) !== 1 ? "s" : ""
                    }}
                  </span>
                </div>
              </button>
            </div>

            <!-- Step 1 navigation -->
            <div class="wizard-nav">
              <button class="nav-btn nav-btn--secondary" @click="router.push('/tasks')">
                Cancel
              </button>
              <button
                class="nav-btn nav-btn--primary"
                :disabled="!canAdvanceStep1"
                @click="goNext"
              >
                Next →
              </button>
            </div>
          </div>
        </Transition>

        <!-- Step 2: Configure -->
        <Transition name="step-fade" mode="out-in">
          <div v-if="currentStep === 2" key="step-2" class="step-content">
            <SectionPanel :title="selectedPreset?.name ?? 'Configure'">
              <template #actions>
                <span class="section-subtitle">
                  Fill in the required parameters for this task.
                </span>
              </template>

              <!-- Task Parameters -->
              <h3 class="section-heading">Task Parameters</h3>

              <div v-if="variables.length === 0" class="empty-variables">
                <span class="empty-text">This preset has no configurable variables.</span>
              </div>

              <div v-else class="form-fields">
                <div v-for="variable in variables" :key="variable.name" class="form-group">
                  <label :for="`var-${variable.name}`" class="form-label">
                    {{ formatVariableLabel(variable.name) }}
                    <span v-if="variable.required" class="required">*</span>
                  </label>

                  <!-- Boolean toggle -->
                  <label
                    v-if="variable.type === 'boolean'"
                    class="toggle-row"
                  >
                    <input
                      :id="`var-${variable.name}`"
                      v-model="formValues[variable.name]"
                      type="checkbox"
                      class="toggle-checkbox"
                    />
                    <span class="toggle-track">
                      <span class="toggle-thumb" />
                    </span>
                    <span class="toggle-label">
                      {{ formValues[variable.name] ? "Enabled" : "Disabled" }}
                    </span>
                  </label>

                  <!-- Number input -->
                  <input
                    v-else-if="variable.type === 'number'"
                    :id="`var-${variable.name}`"
                    v-model.number="formValues[variable.name]"
                    type="number"
                    class="form-input"
                    :placeholder="variable.description"
                  />

                  <!-- Session list textarea -->
                  <textarea
                    v-else-if="variable.type === 'session_list'"
                    :id="`var-${variable.name}`"
                    :value="String(formValues[variable.name] ?? '')"
                    class="form-input form-textarea"
                    rows="3"
                    placeholder="Comma-separated session IDs…"
                    @input="formValues[variable.name] = ($event.target as HTMLTextAreaElement).value"
                  />

                  <!-- Session picker -->
                  <div v-else-if="isSessionVariable(variable)" class="session-picker">
                    <div class="session-search-wrapper">
                      <input
                        :id="`var-${variable.name}`"
                        :value="
                          sessionSearchQuery[variable.name] ??
                          String(formValues[variable.name] ?? '')
                        "
                        type="text"
                        class="form-input"
                        placeholder="Search sessions…"
                        @input="
                          handleSessionSearch(
                            variable.name,
                            ($event.target as HTMLInputElement).value,
                          )
                        "
                      />
                    </div>
                    <div
                      v-if="sessionSearchResults[variable.name]?.length"
                      class="session-results"
                    >
                      <button
                        v-for="session in sessionSearchResults[variable.name]"
                        :key="session.id"
                        class="session-result-item"
                        @click="selectSession(variable.name, session)"
                      >
                        <span class="session-result-id">
                          {{ session.id.slice(0, 8) }}…
                        </span>
                        <span class="session-result-title">
                          {{ session.summary ?? "Untitled session" }}
                        </span>
                      </button>
                    </div>
                    <p v-if="formValues[variable.name]" class="session-selected">
                      Selected: <code>{{ formValues[variable.name] }}</code>
                    </p>
                  </div>

                  <!-- Date input -->
                  <input
                    v-else-if="isDateVariable(variable)"
                    :id="`var-${variable.name}`"
                    :value="String(formValues[variable.name] ?? '')"
                    type="date"
                    class="form-input"
                    @input="formValues[variable.name] = ($event.target as HTMLInputElement).value"
                  />

                  <!-- String text input -->
                  <input
                    v-else
                    :id="`var-${variable.name}`"
                    v-model="formValues[variable.name]"
                    type="text"
                    class="form-input"
                    :placeholder="variable.description"
                  />

                  <p class="form-help">{{ variable.description }}</p>
                </div>
              </div>

              <!-- Execution Options -->
              <div class="execution-divider" />
              <h3 class="section-heading">Execution Options</h3>

              <div class="form-group">
                <label class="form-label">Priority</label>
                <div class="priority-pills">
                  <button
                    v-for="opt in priorityOptions"
                    :key="opt.value"
                    :class="[
                      'priority-pill',
                      `priority-pill--${opt.value}`,
                      { active: priority === opt.value },
                    ]"
                    type="button"
                    @click="priority = opt.value"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>

              <div class="form-group">
                <label for="task-retries" class="form-label">Max Retries</label>
                <input
                  id="task-retries"
                  v-model.number="maxRetries"
                  type="number"
                  class="form-input"
                  style="max-width: 120px"
                  min="0"
                  max="10"
                />
              </div>
            </SectionPanel>

            <!-- Step 2 navigation -->
            <div class="wizard-nav">
              <button class="nav-btn nav-btn--secondary" @click="goBack">
                ← Back
              </button>
              <button
                class="nav-btn nav-btn--primary"
                :disabled="!canAdvanceStep2"
                @click="goNext"
              >
                Next →
              </button>
            </div>
          </div>
        </Transition>

        <!-- Step 3: Review & Submit -->
        <Transition name="step-fade" mode="out-in">
          <div v-if="currentStep === 3" key="step-3" class="step-content">
            <SectionPanel title="Review Configuration">
              <div class="review-section">
                <h3 class="review-heading">Preset</h3>
                <div class="review-row">
                  <span class="review-label">Name</span>
                  <span class="review-value">{{ selectedPreset?.name }}</span>
                </div>
                <div class="review-row">
                  <span class="review-label">Description</span>
                  <span class="review-value review-value--muted">
                    {{ selectedPreset?.description }}
                  </span>
                </div>
              </div>

              <div class="review-section">
                <h3 class="review-heading">Context</h3>
                <div class="review-row">
                  <span class="review-label">Sources</span>
                  <span class="review-value">{{ contextSummary }}</span>
                </div>
                <div v-if="estimatedTokenBudget" class="review-row">
                  <span class="review-label">Token Budget</span>
                  <span class="review-value">
                    ~{{ estimatedTokenBudget.toLocaleString() }} tokens
                  </span>
                </div>
              </div>

              <div v-if="variables.length > 0" class="review-section">
                <h3 class="review-heading">Parameters</h3>
                <div v-for="variable in variables" :key="variable.name" class="review-row">
                  <span class="review-label">{{ formatVariableLabel(variable.name) }}</span>
                  <span
                    :class="[
                      'review-value',
                      { 'review-value--muted': displayValue(variable) === '—' },
                    ]"
                  >
                    {{ displayValue(variable) }}
                  </span>
                </div>
              </div>

              <div class="review-section">
                <h3 class="review-heading">Execution</h3>
                <div class="review-row">
                  <span class="review-label">Priority</span>
                  <span :class="['review-value', `priority--${priority}`]">
                    {{ priority }}
                  </span>
                </div>
                <div class="review-row">
                  <span class="review-label">Max Retries</span>
                  <span class="review-value">{{ maxRetries }}</span>
                </div>
                <div v-if="selectedPreset?.execution.modelOverride" class="review-row">
                  <span class="review-label">Model Override</span>
                  <span class="review-value font-mono">
                    {{ selectedPreset.execution.modelOverride }}
                  </span>
                </div>
                <div class="review-row">
                  <span class="review-label">Timeout</span>
                  <span class="review-value">
                    {{ selectedPreset?.execution.timeoutSeconds }}s
                  </span>
                </div>
              </div>

              <div class="review-section">
                <button
                  class="review-heading review-heading--toggle"
                  @click="promptTemplateExpanded = !promptTemplateExpanded"
                >
                  Prompt Template
                  <span class="toggle-chevron">
                    {{ promptTemplateExpanded ? "▾" : "▸" }}
                  </span>
                </button>
                <pre v-if="promptTemplateExpanded" class="prompt-template">{{
                  selectedPreset?.prompt.user
                }}</pre>
              </div>
            </SectionPanel>

            <!-- Step 3 navigation -->
            <div class="wizard-nav">
              <button class="nav-btn nav-btn--secondary" @click="goBack">
                ← Back
              </button>
              <div class="wizard-nav-actions">
                <button
                  class="nav-btn nav-btn--secondary"
                  :disabled="submitting"
                  @click="handleSubmit(true)"
                >
                  {{ submitting ? "Creating…" : "Create & View" }}
                </button>
                <button
                  class="nav-btn nav-btn--primary nav-btn--submit"
                  :disabled="submitting"
                  @click="handleSubmit(false)"
                >
                  <LoadingSpinner v-if="submitting" size="sm" color="var(--text-on-emphasis)" />
                  <span v-else>🚀</span>
                  {{ submitting ? "Creating…" : "Create Task" }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </template>
  </PageShell>
</template>

<style scoped>
/* ── Header ──────────────────────────────────────────────────────────── */
.wizard-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.back-btn:hover {
  background: var(--neutral-subtle);
  color: var(--text-primary);
  border-color: var(--border-accent);
}

.wizard-title {
  font-size: 1.375rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

/* ── Step indicator ──────────────────────────────────────────────────── */
.step-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  margin-bottom: 32px;
  padding: 16px 20px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
}

.step-dot-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
  border: 2px solid var(--border-default);
  background: var(--canvas-default);
  color: var(--text-placeholder);
  transition: all var(--transition-normal);
  flex-shrink: 0;
}

.step-dot-group.active .step-dot {
  border-color: var(--accent-fg);
  background: var(--accent-subtle);
  color: var(--accent-fg);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

.step-dot-group.completed .step-dot {
  border-color: var(--success-fg);
  background: var(--success-subtle);
  color: var(--success-fg);
}

.step-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-placeholder);
  transition: color var(--transition-fast);
  white-space: nowrap;
}

.step-dot-group.active .step-label {
  color: var(--text-primary);
}

.step-dot-group.completed .step-label {
  color: var(--success-fg);
}

.step-connector {
  flex: 1;
  height: 2px;
  background: var(--border-default);
  margin: 0 12px;
  min-width: 24px;
  max-width: 80px;
  border-radius: 1px;
  transition: background var(--transition-normal);
}

.step-connector.filled {
  background: var(--success-fg);
}

/* ── Loading ─────────────────────────────────────────────────────────── */
.wizard-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  color: var(--text-tertiary);
  font-size: 0.8125rem;
}

/* ── Step transitions ────────────────────────────────────────────────── */
.step-fade-enter-active,
.step-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.step-fade-enter-from {
  opacity: 0;
  transform: translateX(12px);
}

.step-fade-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

/* ── Step 1: Search ──────────────────────────────────────────────────── */
.search-bar {
  position: relative;
  margin-bottom: 20px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-placeholder);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 9px 12px 9px 34px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.8125rem;
  outline: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.search-input::placeholder {
  color: var(--text-placeholder);
}

.search-input:focus {
  border-color: var(--accent-fg);
  box-shadow: 0 0 0 2px var(--accent-subtle);
}

/* ── Step 1: Empty state ─────────────────────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 0;
  color: var(--text-tertiary);
}

.empty-icon {
  font-size: 1.75rem;
}

.empty-text {
  font-size: 0.8125rem;
}

/* ── Step 1: Preset grid ─────────────────────────────────────────────── */
.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.preset-card {
  display: flex;
  flex-direction: column;
  padding: 16px 18px;
  background: var(--canvas-subtle);
  background-image: var(--gradient-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all var(--transition-fast);
  text-align: left;
  color: var(--text-primary);
  font-family: inherit;
  font-size: inherit;
  position: relative;
}

.preset-card:hover {
  border-color: var(--accent-fg);
  box-shadow: 0 0 0 1px var(--accent-subtle), var(--shadow-md);
  transform: translateY(-1px);
}

.preset-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.preset-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.preset-builtin {
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--accent-fg);
  background: var(--accent-subtle);
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  flex-shrink: 0;
}

.preset-description {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  line-height: 1.5;
  margin: 0 0 12px 0;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.preset-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.preset-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;
}

.preset-tag {
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--neutral-subtle);
  padding: 2px 6px;
  border-radius: 4px;
}

.preset-tag--more {
  color: var(--text-placeholder);
}

.preset-meta {
  font-size: 0.6875rem;
  color: var(--text-placeholder);
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Step 2: Form ────────────────────────────────────────────────────── */
.section-subtitle {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-weight: 400;
}

.empty-variables {
  padding: 24px 0;
  text-align: center;
  color: var(--text-tertiary);
}

.form-fields {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group {
  margin-bottom: 14px;
}

.form-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-tertiary);
  margin-bottom: 5px;
}

.required {
  color: var(--danger-fg);
  margin-left: 2px;
}

.form-input {
  width: 100%;
  padding: 7px 10px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.8125rem;
  outline: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.form-input::placeholder {
  color: var(--text-placeholder);
}

.form-input:focus {
  border-color: var(--accent-fg);
  box-shadow: 0 0 0 2px var(--accent-subtle);
}

.form-textarea {
  resize: vertical;
  min-height: 64px;
  font-family: var(--font-mono, "JetBrains Mono", "Fira Code", ui-monospace, monospace);
  font-size: 0.75rem;
  line-height: 1.6;
}

.form-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2371717a' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 30px;
  cursor: pointer;
}

.form-select option {
  background: var(--canvas-overlay);
  color: var(--text-primary);
}

.form-help {
  font-size: 0.6875rem;
  color: var(--text-placeholder);
  margin: 4px 0 0;
  line-height: 1.4;
}

.execution-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: 20px 0;
}

.form-grid-2col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

/* ── Toggle switch ───────────────────────────────────────────────────── */
.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.toggle-checkbox {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-track {
  position: relative;
  width: 36px;
  height: 20px;
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.toggle-checkbox:checked + .toggle-track {
  background: var(--accent-emphasis);
  border-color: var(--accent-emphasis);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: var(--text-secondary);
  border-radius: 50%;
  transition: all var(--transition-fast);
}

.toggle-checkbox:checked + .toggle-track .toggle-thumb {
  left: 18px;
  background: var(--text-on-emphasis);
}

.toggle-label {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

/* ── Step 3: Review ──────────────────────────────────────────────────── */
.review-section {
  margin-bottom: 20px;
}

.review-section:last-child {
  margin-bottom: 0;
}

.review-heading {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-placeholder);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-subtle);
}

.review-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 6px 0;
  gap: 16px;
}

.review-label {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.review-value {
  font-size: 0.8125rem;
  color: var(--text-primary);
  text-align: right;
  word-break: break-word;
  min-width: 0;
}

.review-value--muted {
  color: var(--text-placeholder);
}

.priority--low {
  color: var(--text-tertiary);
}

.priority--normal {
  color: var(--text-secondary);
}

.priority--high {
  color: var(--warning-fg);
}

.priority--critical {
  color: var(--danger-fg);
  font-weight: 600;
}

/* ── Navigation ──────────────────────────────────────────────────────── */
.wizard-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border-subtle);
}

.nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  font-size: 0.8125rem;
  font-weight: 500;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  border: 1px solid transparent;
}

.nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.nav-btn--secondary {
  color: var(--text-secondary);
  background: var(--canvas-subtle);
  border-color: var(--border-default);
}

.nav-btn--secondary:hover:not(:disabled) {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}

.nav-btn--primary {
  color: var(--text-on-emphasis);
  background: var(--accent-emphasis);
  border-color: var(--accent-emphasis);
}

.nav-btn--primary:hover:not(:disabled) {
  background: var(--accent-emphasis-hover);
}

.nav-btn--submit {
  padding: 8px 24px;
}

/* ── Category pills ──────────────────────────────────────────────────── */
.category-pills {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
}

.category-pill {
  padding: 5px 14px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
  font-family: inherit;
}

.category-pill:hover {
  border-color: var(--border-accent);
  color: var(--text-primary);
}

.category-pill.active {
  background: var(--accent-subtle);
  border-color: var(--accent-fg);
  color: var(--accent-fg);
}

/* ── Preset card selected ────────────────────────────────────────────── */
.preset-card--selected {
  border-color: var(--accent-fg);
  box-shadow: 0 0 0 1px var(--accent-subtle), var(--shadow-md);
}

.preset-card--selected::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent-fg);
  border-radius: 10px 10px 0 0;
}

/* ── Clickable step indicator ────────────────────────────────────────── */
.step-dot-group {
  border: none;
  background: none;
  padding: 0;
  font-family: inherit;
}

.step-dot-group:disabled {
  cursor: default;
}

.step-dot-group.clickable {
  cursor: pointer;
}

.step-dot-group.clickable:hover .step-dot {
  border-color: var(--accent-fg);
  box-shadow: 0 0 0 2px var(--accent-subtle);
}

/* ── Section heading ─────────────────────────────────────────────────── */
.section-heading {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-placeholder);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 14px;
}

/* ── Priority pills ──────────────────────────────────────────────────── */
.priority-pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.priority-pill {
  padding: 5px 14px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 500;
  border: 1px solid var(--border-default);
  background: transparent;
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
  color: var(--text-secondary);
}

.priority-pill:hover {
  border-color: var(--border-accent);
}

.priority-pill--low.active {
  background: var(--neutral-muted);
  border-color: var(--neutral-emphasis);
  color: var(--neutral-fg);
}

.priority-pill--normal.active {
  background: var(--accent-muted);
  border-color: var(--accent-fg);
  color: var(--accent-fg);
}

.priority-pill--high.active {
  background: var(--warning-muted);
  border-color: var(--warning-fg);
  color: var(--warning-fg);
}

.priority-pill--critical.active {
  background: var(--danger-muted);
  border-color: var(--danger-fg);
  color: var(--danger-fg);
}

/* ── Session picker ──────────────────────────────────────────────────── */
.session-picker {
  position: relative;
}

.session-search-wrapper {
  position: relative;
}

.session-search-spinner {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
}

.session-results {
  position: absolute;
  z-index: 10;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 180px;
  overflow-y: auto;
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  margin-top: 4px;
  box-shadow: var(--shadow-lg);
}

.session-result-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: none;
  color: var(--text-primary);
  font-size: 0.8125rem;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background var(--transition-fast);
}

.session-result-item:hover {
  background: var(--neutral-subtle);
}

.session-result-id {
  font-family: var(--font-mono, monospace);
  font-size: 0.75rem;
  color: var(--accent-fg);
  flex-shrink: 0;
}

.session-result-title {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-selected {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin: 6px 0 0;
}

.session-selected code {
  font-family: var(--font-mono, monospace);
  font-size: 0.6875rem;
  color: var(--accent-fg);
  background: var(--accent-subtle);
  padding: 1px 4px;
  border-radius: 3px;
}

/* ── Review prompt template ──────────────────────────────────────────── */
.review-heading--toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: none;
  cursor: pointer;
  font-family: inherit;
}

.toggle-chevron {
  font-size: 0.75rem;
  color: var(--text-placeholder);
}

.prompt-template {
  font-family: var(--font-mono, monospace);
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--text-secondary);
  background: var(--canvas-default);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 12px 14px;
  margin: 10px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
}

/* ── Wizard nav actions ──────────────────────────────────────────────── */
.wizard-nav-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* ── Responsive ──────────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .preset-grid {
    grid-template-columns: 1fr;
  }

  .form-grid-2col {
    grid-template-columns: 1fr;
  }

  .step-label {
    display: none;
  }

  .step-connector {
    min-width: 16px;
    margin: 0 6px;
  }
}
</style>
