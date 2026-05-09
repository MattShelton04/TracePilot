<!--
  Searchable picker for Lucide glyphs. Default catalogue is the curated
  ~50-glyph dev-tool subset from `templateCatalogue.ts`; consumers may pass
  a wider list. Trigger button opens a <ModalDialog> that renders a 6-column
  tile grid filterable by name. Returns the selected lucide kebab name.
  See design-system/pages/19-session-launcher.md §LucideIconPicker.
-->
<script setup lang="ts">
import * as LucideIcons from "lucide-vue-next";
import { computed, nextTick, ref, watch } from "vue";
import { type LucideName, TEMPLATE_ICON_CATALOGUE } from "../icons/templateCatalogue";
import ModalDialog from "./ModalDialog.vue";

export interface LucideIconPickerProps {
  modelValue: LucideName | null;
  catalogue?: ReadonlyArray<LucideName>;
  placeholder?: string;
  size?: "sm" | "md";
  /** Optional aria-label for the trigger. */
  ariaLabel?: string;
}

const props = withDefaults(defineProps<LucideIconPickerProps>(), {
  size: "sm",
});

const emit = defineEmits<{ "update:modelValue": [value: LucideName | null] }>();

function kebabToPascal(name: string): string {
  return name
    .split("-")
    .map((p) => (p.length ? p[0].toUpperCase() + p.slice(1) : p))
    .join("");
}

function resolveIcon(name: string | null) {
  if (!name) return null;
  const pascal = kebabToPascal(name);
  return (LucideIcons as Record<string, unknown>)[pascal] ?? null;
}

const isOpen = ref(false);
const query = ref("");
const searchInput = ref<HTMLInputElement | null>(null);

const catalogue = computed(() => props.catalogue ?? TEMPLATE_ICON_CATALOGUE);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return catalogue.value;
  return catalogue.value.filter((n) => n.includes(q));
});

const triggerIcon = computed(() => resolveIcon(props.modelValue));

function open() {
  isOpen.value = true;
  query.value = "";
  nextTick(() => searchInput.value?.focus());
}

function close() {
  isOpen.value = false;
}

function pick(name: LucideName) {
  emit("update:modelValue", name);
  close();
}

function clear() {
  emit("update:modelValue", null);
  close();
}

watch(
  () => isOpen.value,
  (v) => {
    if (!v) query.value = "";
  },
);
</script>

<template>
  <div data-tp-component="LucideIconPicker" class="lip">
    <button
      type="button"
      class="lip__trigger"
      :class="`lip__trigger--${size}`"
      :aria-label="ariaLabel ?? 'Pick an icon'"
      :aria-haspopup="'dialog'"
      :aria-expanded="isOpen"
      @click="open"
    >
      <component
        v-if="triggerIcon"
        :is="triggerIcon"
        :size="size === 'md' ? 20 : 16"
        :stroke-width="1.5"
      />
      <component
        v-else
        :is="(LucideIcons as Record<string, unknown>).CircleDashed"
        :size="size === 'md' ? 20 : 16"
        :stroke-width="1.5"
        class="lip__placeholder-icon"
      />
      <span v-if="placeholder && !modelValue" class="lip__placeholder">{{ placeholder }}</span>
    </button>

    <ModalDialog
      :visible="isOpen"
      title="Pick an icon"
      @update:visible="(v) => !v && close()"
    >
      <div class="lip__picker">
        <input
          ref="searchInput"
          v-model="query"
          type="text"
          class="lip__search"
          placeholder="Search icons…"
          aria-label="Filter icons by name"
        />
        <div class="lip__grid" role="listbox" aria-label="Lucide icons">
          <button
            v-for="name in filtered"
            :key="name"
            type="button"
            role="option"
            class="lip__tile"
            :class="{ 'lip__tile--selected': name === modelValue }"
            :aria-selected="name === modelValue"
            :title="name"
            @click="pick(name)"
          >
            <component
              :is="resolveIcon(name)"
              :size="20"
              :stroke-width="1.5"
            />
          </button>
          <p v-if="!filtered.length" class="lip__empty">No icons match "{{ query }}".</p>
        </div>
        <div class="lip__footer">
          <button
            v-if="modelValue"
            type="button"
            class="lip__clear"
            @click="clear"
          >Clear</button>
          <span v-else />
          <span class="lip__count">{{ filtered.length }} of {{ catalogue.length }}</span>
        </div>
      </div>
    </ModalDialog>
  </div>
</template>

<style scoped>
.lip {
  display: inline-block;
}
.lip__trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--canvas-default);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    border-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}
.lip__trigger--sm {
  width: 32px;
  height: 32px;
  justify-content: center;
}
.lip__trigger--md {
  min-height: 36px;
}
.lip__trigger:hover {
  border-color: var(--border-emphasis);
  background: var(--surface-tertiary);
}
.lip__trigger:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}
.lip__placeholder {
  font-size: 12px;
  color: var(--text-tertiary);
}
.lip__placeholder-icon {
  color: var(--text-tertiary);
}

.lip__picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 320px;
}
.lip__search {
  width: 100%;
  padding: 6px 10px;
  font: inherit;
  font-size: 13px;
  background: var(--canvas-default);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}
.lip__search:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
  border-color: var(--border-accent);
}
.lip__grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 4px;
  max-height: 320px;
  overflow-y: auto;
  padding: 4px;
}
.lip__tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 36px;
  padding: 4px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    background-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    border-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}
.lip__tile:hover {
  background: var(--surface-tertiary);
  color: var(--text-primary);
}
.lip__tile:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}
.lip__tile--selected {
  border-color: var(--border-accent);
  background: var(--accent-subtle);
  color: var(--accent-fg);
}
.lip__empty {
  grid-column: 1 / -1;
  margin: 0;
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
}
.lip__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-tertiary);
}
.lip__clear {
  background: transparent;
  border: none;
  padding: 4px 6px;
  color: var(--text-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.lip__clear:hover {
  color: var(--text-primary);
  background: var(--surface-tertiary);
}
.lip__clear:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}
.lip__count {
  font-variant-numeric: tabular-nums;
}
</style>
