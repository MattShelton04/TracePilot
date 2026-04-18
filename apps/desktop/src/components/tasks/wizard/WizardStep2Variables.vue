<script setup lang="ts">
import { SectionPanel } from "@tracepilot/ui";
import { PRIORITY_OPTIONS, type TaskWizard } from "@/composables/useTaskWizard";

defineProps<{
  wizard: TaskWizard;
}>();
</script>

<template>
  <div class="step-content">
    <SectionPanel :title="wizard.selectedPreset?.name ?? 'Configure'">
      <template #actions>
        <span class="section-subtitle">
          Fill in the required parameters for this task.
        </span>
      </template>

      <h3 class="section-heading">Task Parameters</h3>

      <div v-if="wizard.variables.length === 0" class="empty-variables">
        <span class="empty-text">This preset has no configurable variables.</span>
      </div>

      <div v-else class="form-fields">
        <div v-for="variable in wizard.variables" :key="variable.name" class="form-group">
          <label :for="`var-${variable.name}`" class="form-label">
            {{ wizard.formatVariableLabel(variable.name) }}
            <span v-if="variable.required" class="required">*</span>
          </label>

          <label v-if="variable.type === 'boolean'" class="toggle-row">
            <input
              :id="`var-${variable.name}`"
              v-model="wizard.formValues[variable.name]"
              type="checkbox"
              class="toggle-checkbox"
            />
            <span class="toggle-track">
              <span class="toggle-thumb" />
            </span>
            <span class="toggle-label">
              {{ wizard.formValues[variable.name] ? "Enabled" : "Disabled" }}
            </span>
          </label>

          <input
            v-else-if="variable.type === 'number'"
            :id="`var-${variable.name}`"
            v-model.number="wizard.formValues[variable.name]"
            type="number"
            class="form-input"
            :placeholder="variable.description"
          />

          <textarea
            v-else-if="variable.type === 'session_list'"
            :id="`var-${variable.name}`"
            :value="String(wizard.formValues[variable.name] ?? '')"
            class="form-input form-textarea"
            rows="3"
            placeholder="Comma-separated session IDs…"
            @input="
              wizard.formValues[variable.name] = ($event.target as HTMLTextAreaElement).value
            "
          />

          <div v-else-if="wizard.isSessionVariable(variable)" class="session-picker">
            <div class="session-search-wrapper">
              <input
                :id="`var-${variable.name}`"
                :value="
                  wizard.sessionSearchQuery[variable.name] ??
                  String(wizard.formValues[variable.name] ?? '')
                "
                type="text"
                class="form-input"
                placeholder="Search sessions…"
                @input="
                  wizard.handleSessionSearch(
                    variable.name,
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
            </div>
            <div
              v-if="wizard.sessionSearchResults[variable.name]?.length"
              class="session-results"
            >
              <button
                v-for="session in wizard.sessionSearchResults[variable.name]"
                :key="session.id"
                class="session-result-item"
                @click="wizard.selectSession(variable.name, session)"
              >
                <span class="session-result-id">
                  {{ session.id.slice(0, 8) }}…
                </span>
                <span class="session-result-title">
                  {{ session.summary ?? "Untitled session" }}
                </span>
              </button>
            </div>
            <p v-if="wizard.formValues[variable.name]" class="session-selected">
              Selected: <code>{{ wizard.formValues[variable.name] }}</code>
            </p>
          </div>

          <input
            v-else-if="wizard.isDateVariable(variable)"
            :id="`var-${variable.name}`"
            :value="String(wizard.formValues[variable.name] ?? '')"
            type="date"
            class="form-input"
            @input="
              wizard.formValues[variable.name] = ($event.target as HTMLInputElement).value
            "
          />

          <input
            v-else
            :id="`var-${variable.name}`"
            v-model="wizard.formValues[variable.name]"
            type="text"
            class="form-input"
            :placeholder="variable.description"
          />

          <p class="form-help">{{ variable.description }}</p>
        </div>
      </div>

      <div class="execution-divider" />
      <h3 class="section-heading">Execution Options</h3>

      <div class="form-group">
        <label class="form-label">Priority</label>
        <div class="priority-pills">
          <button
            v-for="opt in PRIORITY_OPTIONS"
            :key="opt.value"
            :class="[
              'priority-pill',
              `priority-pill--${opt.value}`,
              { active: wizard.priority === opt.value },
            ]"
            type="button"
            @click="wizard.priority = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div class="form-group">
        <label for="task-retries" class="form-label">Max Retries</label>
        <input
          id="task-retries"
          v-model.number="wizard.maxRetries"
          type="number"
          class="form-input"
          style="max-width: 120px"
          min="0"
          max="10"
        />
      </div>
    </SectionPanel>

    <div class="wizard-nav">
      <button class="nav-btn nav-btn--secondary" @click="wizard.goBack()">
        ← Back
      </button>
      <button
        class="nav-btn nav-btn--primary"
        :disabled="!wizard.canAdvanceStep2"
        @click="wizard.goNext()"
      >
        Next →
      </button>
    </div>
  </div>
</template>

<style scoped>
.step-content {
  display: block;
}

.section-subtitle {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-weight: 400;
}

.section-heading {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-placeholder);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 14px;
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
</style>
