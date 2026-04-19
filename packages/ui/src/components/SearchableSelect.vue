<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

const props = defineProps<{
  options: string[];
  placeholder?: string;
  modelValue: string;
  disabled?: boolean;
  clearable?: boolean;
  allowCustom?: boolean;
}>();

const emit = defineEmits<(e: "update:modelValue", value: string) => void>();

const isOpen = ref(false);
const searchQuery = ref("");
const selectedIndex = ref(-1);
const containerRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const dropdownRef = ref<HTMLElement | null>(null);
const dropdownStyle = ref<Record<string, string>>({});

// Initialize searchQuery with modelValue
watch(
  () => props.modelValue,
  (val) => {
    if (!isOpen.value) {
      searchQuery.value = val;
    }
  },
  { immediate: true },
);

const filteredOptions = computed(() => {
  if (!searchQuery.value) return props.options;
  const q = searchQuery.value.toLowerCase();
  return props.options.filter((opt) => opt.toLowerCase().includes(q));
});

function updateDropdownPosition() {
  if (!containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const openAbove = spaceBelow < 200 && rect.top > spaceBelow;

  dropdownStyle.value = openAbove
    ? {
        position: "fixed",
        bottom: `${window.innerHeight - rect.top + 4}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
      }
    : {
        position: "fixed",
        top: `${rect.bottom + 4}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
      };
}

function openDropdown() {
  if (props.disabled) return;
  isOpen.value = true;
  selectedIndex.value = -1;
  updateDropdownPosition();
}

function close() {
  isOpen.value = false;
  if (!searchQuery.value && props.clearable) {
    if (props.modelValue !== "") {
      emit("update:modelValue", "");
    }
  } else if (props.allowCustom && searchQuery.value !== props.modelValue) {
    emit("update:modelValue", searchQuery.value);
  } else if (!props.allowCustom && searchQuery.value !== props.modelValue) {
    searchQuery.value = props.modelValue;
  }
}

function selectOption(option: string) {
  searchQuery.value = option;
  emit("update:modelValue", option);
  isOpen.value = false;
  inputRef.value?.blur();
}

function clear(e: Event) {
  e.stopPropagation();
  searchQuery.value = "";
  emit("update:modelValue", "");
  if (!isOpen.value) {
    inputRef.value?.focus();
  }
}

function handleInput() {
  if (!isOpen.value) {
    openDropdown();
  }
  selectedIndex.value = -1;
}

function handleKeydown(e: KeyboardEvent) {
  if (!isOpen.value && e.key !== "Escape" && e.key !== "Tab") {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
      openDropdown();
      e.preventDefault();
    }
    return;
  }

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      selectedIndex.value = Math.min(selectedIndex.value + 1, filteredOptions.value.length - 1);
      scrollIntoView();
      break;
    case "ArrowUp":
      e.preventDefault();
      selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
      scrollIntoView();
      break;
    case "Enter":
      e.preventDefault();
      if (!searchQuery.value && props.clearable) {
        selectOption("");
      } else if (selectedIndex.value >= 0) {
        selectOption(filteredOptions.value[selectedIndex.value]);
      } else if (filteredOptions.value.length === 1 && !props.allowCustom && searchQuery.value) {
        selectOption(filteredOptions.value[0]);
      } else if (props.allowCustom && searchQuery.value) {
        selectOption(searchQuery.value);
      }
      break;
    case "Escape":
      e.preventDefault();
      close();
      inputRef.value?.blur();
      break;
  }
}

function scrollIntoView() {
  nextTick(() => {
    const el = listRef.value?.querySelector(".option-item.selected") as HTMLElement;
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  });
}

function handleClickOutside(e: MouseEvent) {
  const target = e.target as Node;
  if (
    containerRef.value &&
    !containerRef.value.contains(target) &&
    dropdownRef.value &&
    !dropdownRef.value.contains(target)
  ) {
    close();
  }
}

function handleScrollOrResize() {
  if (isOpen.value) updateDropdownPosition();
}

onMounted(() => {
  document.addEventListener("mousedown", handleClickOutside);
  window.addEventListener("scroll", handleScrollOrResize, true);
  window.addEventListener("resize", handleScrollOrResize);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleClickOutside);
  window.removeEventListener("scroll", handleScrollOrResize, true);
  window.removeEventListener("resize", handleScrollOrResize);
});

watch(filteredOptions, () => {
  selectedIndex.value = -1;
});
</script>

<template>
  <div ref="containerRef" class="searchable-select" :class="{ 'is-open': isOpen, 'is-disabled': disabled }">
    <div class="select-trigger-wrapper">
      <input
        ref="inputRef"
        v-model="searchQuery"
        type="text"
        class="select-input-trigger"
        :placeholder="placeholder || 'Select option...'"
        :disabled="disabled"
        @focus="openDropdown"
        @input="handleInput"
        @keydown="handleKeydown"
      />
      <span class="trigger-actions">
        <button
          v-if="clearable && searchQuery"
          class="clear-btn"
          title="Clear selection"
          aria-label="Clear selection"
          @mousedown.prevent="clear"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>
        </button>
        <svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" @mousedown.prevent="isOpen ? close() : openDropdown()">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>
    </div>

    <Teleport to="body">
      <div v-if="isOpen" ref="dropdownRef" class="tp-select-dropdown" :style="dropdownStyle">
        <div ref="listRef" class="options-list">
          <div
            v-for="(opt, idx) in filteredOptions"
            :key="opt"
            class="option-item"
            :class="{ selected: idx === selectedIndex, active: opt === modelValue }"
            @mousedown.prevent="selectOption(opt)"
          >
            {{ opt }}
          </div>
          <div v-if="filteredOptions.length === 0" class="no-options">
            <template v-if="allowCustom">Press Enter to use "{{ searchQuery }}"</template>
            <template v-else>No matches found</template>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.searchable-select {
  position: relative;
  width: 100%;
}

.select-trigger-wrapper {
  display: flex;
  align-items: center;
  position: relative;
}

.select-input-trigger {
  width: 100%;
  padding: 7px 40px 7px 10px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.8125rem;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  min-height: 32px;
}

.select-input-trigger:focus {
  outline: none;
  border-color: var(--accent-emphasis);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-emphasis) 25%, transparent);
}

.searchable-select.is-disabled .select-input-trigger {
  opacity: 0.5;
  cursor: not-allowed;
}

.trigger-actions {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
}

.chevron {
  color: var(--text-tertiary);
  transition: transform 0.2s ease;
  cursor: pointer;
  flex-shrink: 0;
}

.is-open .chevron {
  transform: rotate(180deg);
}

.clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
  flex-shrink: 0;
}

.clear-btn:hover {
  color: var(--text-primary);
  background: var(--neutral-subtle);
}
</style>

<!-- Unscoped: dropdown is <Teleport>'d to <body>, so scoped attrs don't reach it.
     All rules are prefixed with .tp-select-dropdown to avoid collisions. -->
<style>
.tp-select-dropdown {
  z-index: 9999;
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 300px;
}

.tp-select-dropdown .options-list {
  overflow-y: auto;
  padding: 4px;
}

.tp-select-dropdown .option-item {
  padding: 6px 10px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.1s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tp-select-dropdown .option-item:hover,
.tp-select-dropdown .option-item.selected {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}

.tp-select-dropdown .option-item.active {
  background: var(--accent-subtle);
  color: var(--accent-fg);
  font-weight: 600;
}

.tp-select-dropdown .no-options {
  padding: 12px;
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-style: italic;
}
</style>
