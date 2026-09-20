<script setup lang="ts">
/**
 * Writes `subagents.agents.<agentType>` in settings.json — the supported
 * route the CLI's `/subagents` uses, which survives CLI updates. `inherit`
 * means "use whatever the session runs with".
 */
import { getAllModelIds } from "@tracepilot/types";
import { ActionButton, Field, ModalDialog, SearchableSelect, Select, Toggle } from "@tracepilot/ui";
import { computed, ref, watch } from "vue";
import { useAgentEditorContext } from "@/composables/useAgentEditor";

const visible = defineModel<boolean>("visible", { required: true });

const ctx = useAgentEditorContext();
/** `inherit` is a real value here: it pins the agent to the session model. */
const modelOptions = ["inherit", ...getAllModelIds()];

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

      <Field
        v-slot="{ id }"
        label="Model"
        layout="stacked"
        description="A model id, or “inherit” to follow the session model. Clearing it removes the key."
      >
        <SearchableSelect
          v-model="model"
          :input-id="id"
          :options="modelOptions"
          allow-custom
          clearable
          placeholder="Not set"
        />
      </Field>

      <Field label="Reasoning effort" layout="stacked">
        <Select v-model="effort" :options="effortOptions" aria-label="Override reasoning effort" />
      </Field>

      <Field label="Context tier" layout="stacked">
        <Select v-model="contextTier" :options="tierOptions" aria-label="Override context tier" />
      </Field>

      <div class="override__divider" />

      <Field
        class="override__switch"
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

.override__divider {
  height: 1px;
  background: var(--border-default);
}

/* An inline Field splits the row 1fr / 1.4fr, which left the toggle floating
   mid-dialog. The switch needs only its own width, at the end of the row. */
.override .override__switch {
  grid-template-columns: minmax(0, 1fr) auto;
  padding: 0;
}

.override .override__switch :deep(.field__control-row) {
  justify-content: flex-end;
}
</style>
