<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';

const props = defineProps<{
  options: string[];
  placeholder?: string;
  modelValue: string;
  disabled?: boolean;
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

const filteredOptions = computed(() => {
  if (!searchQuery.value) return props.options;
  const q = searchQuery.value.toLowerCase();
  return props.options.filter(opt => opt.toLowerCase().includes(q));
});

function toggle() {
  if (props.disabled) return;
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    searchQuery.value = '';
    selectedIndex.value = -1;
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
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    close();
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
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
      <svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>

    <div v-if="isOpen" class="select-dropdown">
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
}

.is-open .chevron {
  transform: rotate(180deg);
}

.select-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 50;
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 300px;
}

.search-wrapper {
  padding: 8px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--canvas-subtle);
}

.search-input {
  width: 100%;
  padding: 6px 10px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 0.75rem;
  outline: none;
}

.search-input:focus {
  border-color: var(--accent-emphasis);
}

.options-list {
  overflow-y: auto;
  padding: 4px;
}

.option-item {
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

.option-item:hover,
.option-item.selected {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}

.option-item.active {
  background: var(--accent-subtle);
  color: var(--accent-fg);
  font-weight: 600;
}

.no-options {
  padding: 12px;
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-style: italic;
}
</style>
