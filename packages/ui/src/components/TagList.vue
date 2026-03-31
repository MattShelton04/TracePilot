<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  tags: string[];
  editable?: boolean;
  placeholder?: string;
}>();

const emit = defineEmits<{
  "update:tags": [tags: string[]];
}>();

const newTag = ref("");

function addTag(tags: string[]) {
  const trimmed = newTag.value.trim();
  if (trimmed && !tags.includes(trimmed)) {
    emit("update:tags", [...tags, trimmed]);
  }
  newTag.value = "";
}

function removeTag(tags: string[], index: number) {
  const next = [...tags];
  next.splice(index, 1);
  emit("update:tags", next);
}

function onKeydown(e: KeyboardEvent, tags: string[]) {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    addTag(tags);
  }
}
</script>

<template>
  <div class="tag-list">
    <span v-for="(tag, i) in tags" :key="tag" class="tag-item">
      {{ tag }}
      <button v-if="editable" class="tag-remove" @click="removeTag(tags, i)" aria-label="Remove tag">×</button>
    </span>
    <input
      v-if="editable"
      v-model="newTag"
      class="tag-input"
      :placeholder="placeholder ?? 'Add tag…'"
      @keydown="(e: KeyboardEvent) => onKeydown(e, tags)"
      @blur="addTag(tags)"
    />
  </div>
</template>

<style scoped>
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.tag-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  background: var(--neutral-muted);
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
}
.tag-remove {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.875rem;
  padding: 0 2px;
  line-height: 1;
}
.tag-remove:hover {
  color: var(--danger-emphasis);
}
.tag-input {
  background: transparent;
  border: 1px dashed var(--border-default);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 0.75rem;
  color: var(--text-primary);
  min-width: 80px;
  max-width: 160px;
  outline: none;
}
.tag-input:focus {
  border-color: var(--accent-emphasis);
}
</style>
