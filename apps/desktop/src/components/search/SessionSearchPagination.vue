<script setup lang="ts">
defineProps<{
  page: number;
  totalPages: number;
  totalCount: number;
  hasMore: boolean;
  visiblePages: (number | null)[];
  pageStart: number;
  pageEnd: number;
}>();

const emit = defineEmits<{
  (e: "prev"): void;
  (e: "next"): void;
  (e: "go", page: number): void;
}>();
</script>

<template>
  <div v-if="totalPages > 1" class="pagination">
    <button
      class="pagination-btn"
      :disabled="page <= 1"
      @click="emit('prev')"
    >
      ‹ Prev
    </button>
    <template v-for="(p, idx) in visiblePages" :key="idx">
      <span v-if="p === null" class="pagination-ellipsis">…</span>
      <button
        v-else
        class="pagination-btn"
        :class="{ active: p === page }"
        @click="emit('go', p)"
      >
        {{ p }}
      </button>
    </template>
    <button
      class="pagination-btn"
      :disabled="!hasMore"
      @click="emit('next')"
    >
      Next ›
    </button>
    <span class="pagination-info">
      {{ pageStart }}–{{ pageEnd }} of {{ totalCount.toLocaleString() }}
    </span>
  </div>
</template>
