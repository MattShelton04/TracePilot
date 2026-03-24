<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';

const props = defineProps<{
  options: string[];
  placeholder?: string;
  modelValue: string;
  disabled?: boolean;
  clearable?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const isOpen = ref(false);
const searchQuery = ref('');
const selectedIndex = ref(-1);
const containerRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const dropdownRef = ref<HTMLElement | null>(null);
const dropdownStyle = ref<Record<string, string>>({});

const filteredOptions = computed(() => {
  if (!searchQuery.value) return props.options;
  const q = searchQuery.value.toLowerCase();
  return props.options.filter(opt => opt.toLowerCase().includes(q));
});

function updateDropdownPosition() {
  if (!containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const openAbove = spaceBelow < 200 && rect.top > spaceBelow;

  dropdownStyle.value = openAbove
    ? { position: 'fixed', bottom: `${window.innerHeight - rect.top + 4}px`, left: `${rect.left}px`, width: `${rect.width}px` }
    : { position: 'fixed', top: `${rect.bottom + 4}px`, left: `${rect.left}px`, width: `${rect.width}px` };
}

function toggle() {
  if (props.disabled) return;
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    searchQuery.value = '';
    selectedIndex.value = -1;
    updateDropdownPosition();
    nextTick(() => {
      inputRef.value?.focus();
    });
  }
}

function selectOption(option: string) {
  emit('update:modelValue', option);
  isOpen.value = false;
}

function close() {
  isOpen.value = false;
}

function clear(e: Event) {
  e.stopPropagation();
  emit('update:modelValue', '');
  close();
}

function handleKeydown(e: KeyboardEvent) {
  if (!isOpen.value) {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      toggle();
    }
    return;
  }

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      selectedIndex.value = Math.min(selectedIndex.value + 1, filteredOptions.value.length - 1);
      scrollIntoView();
      break;
    case 'ArrowUp':
      e.preventDefault();
      selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
      scrollIntoView();
      break;
    case 'Enter':
      e.preventDefault();
      if (selectedIndex.value >= 0) {
        selectOption(filteredOptions.value[selectedIndex.value]);
      } else if (filteredOptions.value.length === 1) {
        selectOption(filteredOptions.value[0]);
      }
      break;
    case 'Escape':
      e.preventDefault();
      close();
      break;
  }
}

function scrollIntoView() {
  nextTick(() => {
    const el = listRef.value?.querySelector('.option-item.selected') as HTMLElement;
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  });
}

function handleClickOutside(e: MouseEvent) {
  const target = e.target as Node;
  if (
    containerRef.value && !containerRef.value.contains(target) &&
    dropdownRef.value && !dropdownRef.value.contains(target)
  ) {
    close();
  }
}

function handleScrollOrResize() {
  if (isOpen.value) updateDropdownPosition();
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  window.addEventListener('scroll', handleScrollOrResize, true);
  window.addEventListener('resize', handleScrollOrResize);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  window.removeEventListener('scroll', handleScrollOrResize, true);
  window.removeEventListener('resize', handleScrollOrResize);
});

watch(filteredOptions, () => {
  selectedIndex.value = -1;
});
</script>

<template>
  <div ref="containerRef" class="searchable-select" :class="{ 'is-open': isOpen, 'is-disabled': disabled }">
    <div class="select-trigger" @click="toggle" @keydown="handleKeydown" tabindex="0">
      <span v-if="modelValue" class="selected-value">{{ modelValue }}</span>
      <span v-else class="placeholder">{{ placeholder || 'Select option...' }}</span>
      <span class="trigger-actions">
        <button
          v-if="clearable && modelValue"
          class="clear-btn"
          title="Clear selection"
          @click="clear"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>
        </button>
        <svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>
    </div>

    <Teleport to="body">
      <div v-if="isOpen" ref="dropdownRef" class="select-dropdown" :style="dropdownStyle">
        <div class="search-wrapper">
          <input
            ref="inputRef"
            v-model="searchQuery"
            type="text"
            class="search-input"
            placeholder="Type to filter..."
            @keydown="handleKeydown"
          />
        </div>
        <div ref="listRef" class="options-list">
          <div
            v-for="(opt, idx) in filteredOptions"
            :key="opt"
            class="option-item"
            :class="{ selected: idx === selectedIndex, active: opt === modelValue }"
            @click="selectOption(opt)"
          >
            {{ opt }}
          </div>
          <div v-if="filteredOptions.length === 0" class="no-options">
            No matches found
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

.select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: border-color 0.15s ease;
  min-height: 32px;
}

.select-trigger:focus {
  outline: none;
  border-color: var(--accent-emphasis);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-emphasis) 25%, transparent);
}

.searchable-select.is-disabled .select-trigger {
  opacity: 0.5;
  cursor: not-allowed;
}

.placeholder {
  color: var(--text-placeholder);
}

.chevron {
  color: var(--text-tertiary);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.is-open .chevron {
  transform: rotate(180deg);
}

.trigger-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
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
}

.clear-btn:hover {
  color: var(--text-primary);
  background: var(--neutral-subtle);
}

.selected-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
</style>

<!-- Unscoped styles for the teleported dropdown -->
<style>
.select-dropdown {
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

.select-dropdown .search-wrapper {
  padding: 8px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--canvas-subtle);
}

.select-dropdown .search-input {
  width: 100%;
  padding: 6px 10px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 0.75rem;
  outline: none;
}

.select-dropdown .search-input:focus {
  border-color: var(--accent-emphasis);
}

.select-dropdown .options-list {
  overflow-y: auto;
  padding: 4px;
}

.select-dropdown .option-item {
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

.select-dropdown .option-item:hover,
.select-dropdown .option-item.selected {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}

.select-dropdown .option-item.active {
  background: var(--accent-subtle);
  color: var(--accent-fg);
  font-weight: 600;
}

.select-dropdown .no-options {
  padding: 12px;
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-style: italic;
}
</style>
