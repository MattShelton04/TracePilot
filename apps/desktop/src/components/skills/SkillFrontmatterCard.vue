<script setup lang="ts">
import type { SkillFrontmatter } from "@tracepilot/types";
import { ref, watch } from "vue";

const props = defineProps<{
  frontmatter: SkillFrontmatter;
  editable?: boolean;
}>();

const emit = defineEmits<{
  update: [fm: SkillFrontmatter];
}>();

const localName = ref(props.frontmatter.name);
const localDesc = ref(props.frontmatter.description);
const localGlobs = ref<string[]>([...(props.frontmatter.resource_globs ?? [])]);
const localAutoAttach = ref(props.frontmatter.auto_attach ?? false);
const newGlob = ref("");

watch(
  () => props.frontmatter,
  (fm) => {
    localName.value = fm.name;
    localDesc.value = fm.description;
    localGlobs.value = [...(fm.resource_globs ?? [])];
    localAutoAttach.value = fm.auto_attach ?? false;
  },
);

function emitUpdate() {
  emit("update", {
    name: localName.value,
    description: localDesc.value,
    resource_globs: localGlobs.value.length > 0 ? localGlobs.value : undefined,
    auto_attach: localAutoAttach.value || undefined,
  });
}

function addGlob() {
  const g = newGlob.value.trim();
  if (g && !localGlobs.value.includes(g)) {
    localGlobs.value.push(g);
    newGlob.value = "";
    emitUpdate();
  }
}

function removeGlob(index: number) {
  localGlobs.value.splice(index, 1);
  emitUpdate();
}
</script>

<template>
  <div class="fm-card">
    <h4 class="fm-card__title">Frontmatter</h4>

    <div class="fm-card__field">
      <label class="fm-card__label">Name</label>
      <input
        v-if="editable"
        v-model="localName"
        class="fm-card__input"
        type="text"
        @change="emitUpdate"
      />
      <span v-else class="fm-card__value">{{ frontmatter.name }}</span>
    </div>

    <div class="fm-card__field">
      <label class="fm-card__label">Description</label>
      <textarea
        v-if="editable"
        v-model="localDesc"
        class="fm-card__textarea"
        rows="2"
        @change="emitUpdate"
      />
      <span v-else class="fm-card__value">{{ frontmatter.description || "—" }}</span>
    </div>

    <div class="fm-card__field">
      <label class="fm-card__label">Resource Globs</label>
      <div class="fm-card__globs">
        <span
          v-for="(glob, i) in (editable ? localGlobs : (frontmatter.resource_globs ?? []))"
          :key="i"
          class="fm-card__glob-tag"
        >
          <code>{{ glob }}</code>
          <button
            v-if="editable"
            class="fm-card__glob-remove"
            @click="removeGlob(i)"
            title="Remove glob"
          >×</button>
        </span>
        <span
          v-if="(editable ? localGlobs : (frontmatter.resource_globs ?? [])).length === 0"
          class="fm-card__empty"
        >None</span>
      </div>
      <div v-if="editable" class="fm-card__glob-add">
        <input
          v-model="newGlob"
          class="fm-card__input fm-card__input--sm"
          type="text"
          placeholder="e.g. **/*.ts"
          @keydown.enter.prevent="addGlob"
        />
        <button class="fm-card__btn" @click="addGlob">Add</button>
      </div>
    </div>

    <div class="fm-card__field">
      <label class="fm-card__label">
        <span>Auto-attach</span>
        <label class="fm-card__toggle">
          <input
            type="checkbox"
            :checked="editable ? localAutoAttach : (frontmatter.auto_attach ?? false)"
            :disabled="!editable"
            @change="localAutoAttach = !localAutoAttach; emitUpdate()"
          />
          <span class="toggle-slider" />
        </label>
      </label>
    </div>
  </div>
</template>

<style scoped>
.fm-card {
  padding: 16px;
  border-radius: var(--radius-lg);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
}

.fm-card__title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px;
}

.fm-card__field {
  margin-bottom: 12px;
}

.fm-card__field:last-child {
  margin-bottom: 0;
}

.fm-card__label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.fm-card__value {
  font-size: 0.8125rem;
  color: var(--text-primary);
}

.fm-card__input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-default);
  color: var(--text-primary);
  font-size: 0.8125rem;
  outline: none;
  transition: border-color var(--transition-fast);
}

.fm-card__input:focus {
  border-color: var(--accent-fg);
}

.fm-card__input--sm {
  flex: 1;
}

.fm-card__textarea {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-default);
  color: var(--text-primary);
  font-size: 0.8125rem;
  resize: vertical;
  outline: none;
  font-family: inherit;
  transition: border-color var(--transition-fast);
}

.fm-card__textarea:focus {
  border-color: var(--accent-fg);
}

.fm-card__globs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.fm-card__glob-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--canvas-inset);
  font-size: 0.75rem;
  color: var(--text-primary);
}

.fm-card__glob-tag code {
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.fm-card__glob-remove {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.875rem;
  padding: 0 2px;
  line-height: 1;
}

.fm-card__glob-remove:hover {
  color: var(--danger-fg);
}

.fm-card__glob-add {
  display: flex;
  gap: 6px;
  align-items: center;
}

.fm-card__btn {
  padding: 4px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  color: var(--text-primary);
  font-size: 0.75rem;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--transition-fast);
}

.fm-card__btn:hover {
  background: var(--accent-muted);
}

.fm-card__empty {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-style: italic;
}

/* Toggle */
.fm-card__toggle {
  position: relative;
  display: inline-flex;
  cursor: pointer;
}

.fm-card__toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  width: 32px;
  height: 18px;
  background: var(--canvas-inset);
  border-radius: 9px;
  position: relative;
  transition: background 0.2s ease;
}

.toggle-slider::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: var(--text-tertiary);
  border-radius: 50%;
  transition: transform 0.2s ease, background 0.2s ease;
}

.fm-card__toggle input:checked + .toggle-slider {
  background: var(--success-emphasis);
}

.fm-card__toggle input:checked + .toggle-slider::after {
  transform: translateX(14px);
  background: var(--text-on-emphasis, #fff);
}

.fm-card__toggle input:disabled + .toggle-slider {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
