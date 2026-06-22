<script setup lang="ts">
import { formatNumberFull } from "@tracepilot/types";

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
  <nav v-if="totalPages > 1" class="pagination" aria-label="Pagination">
    <button
      class="pagination-btn"
      :disabled="page <= 1"
      aria-label="Previous page"
      @click="emit('prev')"
    >
      <span aria-hidden="true">‹</span> Prev
    </button>
    <template v-for="(p, idx) in visiblePages" :key="idx">
      <span v-if="p === null" class="pagination-ellipsis" aria-hidden="true">…</span>
      <button
        v-else
        class="pagination-btn"
        :class="{ active: p === page }"
        :aria-current="p === page ? 'page' : undefined"
        :aria-label="`Page ${p}`"
        @click="emit('go', p)"
      >
        {{ p }}
      </button>
    </template>
    <button
      class="pagination-btn"
      :disabled="!hasMore"
      aria-label="Next page"
      @click="emit('next')"
    >
      Next <span aria-hidden="true">›</span>
    </button>
    <span class="pagination-info">
      {{ pageStart }}–{{ pageEnd }} of {{ formatNumberFull(totalCount) }}
    </span>
  </nav>
</template>
