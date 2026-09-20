<script setup lang="ts">
/**
 * Creates a custom agent from the backend template, personal or in one of
 * the registered repositories. The editor then opens on the new file.
 */
import type { AgentCreateScope } from "@tracepilot/types";
import { ActionButton, Field, FormInput, ModalDialog, Select } from "@tracepilot/ui";
import { computed, ref, watch } from "vue";
import { useAgentsStore } from "@/stores/agents";

const visible = defineModel<boolean>("visible", { required: true });
const emit = defineEmits<{ created: [path: string] }>();

const store = useAgentsStore();
const name = ref("");
const description = ref("");
const scope = ref<AgentCreateScope>("personal");
const repoRoot = ref("");
const creating = ref(false);
const error = ref<string | null>(null);

const repoRoots = computed(() => store.catalog?.repoRoots ?? []);
const scopeOptions = computed(() => [
  { value: "personal", label: `Personal (${store.catalog?.personalDir ?? "~/.copilot/agents"})` },
  {
    value: "project",
    label: "Project (.github/agents)",
    disabled: repoRoots.value.length === 0,
  },
]);
const repoOptions = computed(() => repoRoots.value.map((root) => ({ value: root, label: root })));

/** `name` becomes the file stem, so keep it to what the CLI can dispatch. */
const nameError = computed(() => {
  const value = name.value.trim();
  if (!value) return "";
  return /^[a-z0-9][a-z0-9-]*$/.test(value)
    ? ""
    : "Use lower-case letters, digits and hyphens, starting with a letter or digit.";
});
const canCreate = computed(
  () =>
    !creating.value &&
    name.value.trim().length > 0 &&
    !nameError.value &&
    (scope.value === "personal" || repoRoot.value.length > 0),
);

watch(visible, (open) => {
  if (!open) return;
  name.value = "";
  description.value = "";
  error.value = null;
  scope.value = "personal";
  repoRoot.value = repoRoots.value[0] ?? "";
});

async function create() {
  if (!canCreate.value) return;
  creating.value = true;
  error.value = null;
  const path = await store.createAgent(
    scope.value,
    name.value.trim(),
    description.value.trim(),
    scope.value === "project" ? repoRoot.value : null,
  );
  creating.value = false;
  if (path) {
    visible.value = false;
    emit("created", path);
  } else {
    error.value = store.error ?? "Could not create the agent. Try again.";
    store.clearError();
  }
}
</script>

<template>
  <ModalDialog v-model:visible="visible" title="New Agent">
    <div class="agent-create">
      <p v-if="error" class="agent-create__error" role="alert">{{ error }}</p>

      <Field label="Scope" layout="stacked">
        <Select
          :model-value="scope"
          :options="scopeOptions"
          aria-label="Agent scope"
          @update:model-value="scope = $event as AgentCreateScope"
        />
      </Field>

      <Field
        v-if="scope === 'project'"
        label="Repository"
        layout="stacked"
        :description="repoRoots.length ? undefined : 'Register a repository first to create a project agent.'"
      >
        <Select
          v-model="repoRoot"
          :options="repoOptions"
          :disabled="repoRoots.length === 0"
          aria-label="Repository"
        />
      </Field>

      <Field
        label="Name"
        layout="stacked"
        :description="`Saved as ${name.trim() || 'name'}.agent.md`"
        :status="nameError ? 'error' : 'clean'"
        :error-message="nameError"
        required
      >
        <FormInput v-model="name" placeholder="code-reviewer" @keydown.enter="create" />
      </Field>

      <Field
        label="Description"
        layout="stacked"
        description="Shown to the model when it picks an agent."
      >
        <FormInput v-model="description" placeholder="Reviews changes for correctness bugs." />
      </Field>
    </div>

    <template #footer>
      <ActionButton @click="visible = false">Cancel</ActionButton>
      <ActionButton variant="primary" :disabled="!canCreate" :loading="creating" @click="create">
        Create
      </ActionButton>
    </template>
  </ModalDialog>
</template>

<style scoped>
.agent-create {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agent-create__error {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  background: var(--danger-subtle);
  color: var(--danger-fg);
  font-size: 0.75rem;
}
</style>
