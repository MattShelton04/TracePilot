<script setup lang="ts">
defineProps<{
  total: number;
  current: number; // 0-based
}>();
</script>

<template>
  <div class="mini-timeline" role="progressbar" :aria-valuenow="current + 1" :aria-valuemax="total">
    <span
      v-for="i in total"
      :key="i"
      class="mini-dot"
      :class="{
        completed: i - 1 < current,
        current: i - 1 === current,
        future: i - 1 > current,
      }"
      :aria-label="`Step ${i} of ${total}`"
    />
  </div>
</template>

<style scoped>
.mini-timeline {
  display: flex;
  gap: 6px;
  align-items: center;
}
.mini-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transition: all var(--transition-normal);
}
.mini-dot.completed {
  background: var(--accent-emphasis);
}
.mini-dot.current {
  background: var(--accent-fg);
  box-shadow: 0 0 8px var(--accent-emphasis);
  width: 10px;
  height: 10px;
}
.mini-dot.future {
  background: var(--border-default);
}
</style>
