<script setup lang="ts">
/**
 * Writes `subagents.agents.<agentType>` in settings.json — the supported
 * route the CLI's `/subagents` uses, which survives CLI updates. `inherit`
 * means "use whatever the session runs with".
 */
import { getAllModelIds } from "@tracepilot/types";
import { ActionButton, Field, ModalDialog, Select, Toggle } from "@tracepilot/ui";
import { computed, ref, useId, watch } from "vue";
import { useAgentEditorContext } from "@/composables/useAgentEditor";

const visible = defineModel<boolean>("visible", { required: true });

const ctx = useAgentEditorContext();
const listId = useId();
const knownModels = getAllModelIds();

const model = ref("");
const effort = ref("");
const contextTier = ref("");
const disabled = ref(false);
const saving = ref(false);

const effortOptions = [
  { value: "", label: "Not set" },
  { value: "inherit", label: "inherit — the session's effort" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
];

const tierOptions = [
  { value: "", label: "Not set" },
  { value: "inherit", label: "inherit" },
  { value: "default", label: "default" },
  { value: "long_context", label: "long_context" },
];

const hasOverride = computed(() => Boolean(ctx.override));
const changed = computed(
  () =>
    model.value !== (ctx.override?.model ?? "") ||
    effort.value !== (ctx.override?.effortLevel ?? "") ||
    contextTier.value !== (ctx.override?.contextTier ?? "") ||
    disabled.value !== ctx.disabled,
);

watch(visible, (open) => {
  if (!open) return;
  model.value = ctx.override?.model ?? "";
  effort.value = ctx.override?.effortLevel ?? "";
  contextTier.value = ctx.override?.contextTier ?? "";
  disabled.value = ctx.disabled;
});

async function apply() {
  saving.value = true;
  const hasValue = Boolean(model.value || effort.value || contextTier.value);
  await ctx.setOverride(
    hasValue
      ? {
          model: model.value || null,
          effortLevel: effort.value || null,
          contextTier: contextTier.value || null,
        }
      : null,
  );
  if (disabled.value !== ctx.disabled) await ctx.setDisabled(disabled.value);
  saving.value = false;
  visible.value = false;
}

async function reset() {
  saving.value = true;
  await ctx.setOverride(null);
  if (ctx.disabled) await ctx.setDisabled(false);
  saving.value = false;
  visible.value = false;
}
</script>

<template>
  <ModalDialog v-model:visible="visible" :title="`Override ${ctx.agentType}`">
    <div class="override">
      <p class="override__intro">
        Written to <code>{{ ctx.settings?.settingsPath ?? "settings.json" }}</code> under
        <code>subagents.agents.{{ ctx.agentType }}</code>, the same place <code>/subagents</code>
        writes. Unlike editing the installed definition, this survives CLI updates.
      </p>

      <datalist :id="listId">
        <option value="inherit" />
        <option v-for="id in knownModels" :key="id" :value="id" />
      </datalist>

      <Field
        label="Model"
        layout="stacked"
        description="A model id, or `inherit` to follow the session model. Empty removes the key."
      >
        <input
          v-model="model"
          type="text"
          class="override__input"
          :list="listId"
          spellcheck="false"
          placeholder="inherit"
          aria-label="Override model"
        />
      </Field>

      <Field label="Reasoning effort" layout="stacked">
        <Select v-model="effort" :options="effortOptions" aria-label="Override reasoning effort" />
      </Field>

      <Field label="Context tier" layout="stacked">
        <Select v-model="contextTier" :options="tierOptions" aria-label="Override context tier" />
      </Field>

      <Field
        label="Disabled"
        layout="inline"
        description="Adds the agent to disabledSubagents so the CLI will not run it."
      >
        <Toggle v-model="disabled" />
      </Field>
    </div>

    <template #footer>
      <ActionButton v-if="hasOverride || ctx.disabled" :disabled="saving" @click="reset">
        Remove override
      </ActionButton>
      <ActionButton @click="visible = false">Cancel</ActionButton>
      <ActionButton variant="primary" :disabled="!changed" :loading="saving" @click="apply">
        Apply
      </ActionButton>
    </template>
  </ModalDialog>
</template>

<style scoped>
.override {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.override__intro {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  line-height: 1.5;
}

.override__intro code {
  font-family: var(--font-mono);
  color: var(--text-secondary);
}

.override__input {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-default, var(--canvas-subtle));
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.override__input:focus {
  outline: none;
  border-color: var(--accent-fg);
}
</style>
