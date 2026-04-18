<script setup lang="ts">
import type { IndexingProgressPayload } from "@tracepilot/types";
import { computed } from "vue";

const props = defineProps<{
  isIndexing: boolean;
  searchIndexing: boolean;
  rebuilding: boolean;
  indexingProgress: IndexingProgressPayload | null;
  searchIndexingProgress: { current: number; total: number } | null;
}>();

const visible = computed(() => props.isIndexing || props.searchIndexing || props.rebuilding);
</script>

<template>
  <div v-if="visible" class="indexing-banner">
    <div class="indexing-banner-content">
      <svg class="indexing-banner-icon spin-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M2 8a6 6 0 0 1 10.2-4.3M14 8a6 6 0 0 1-10.2 4.3" />
        <path d="M12.2 1v3h-3M3.8 15v-3h3" />
      </svg>
      <span class="indexing-banner-text">
        <template v-if="rebuilding">Rebuilding search index…</template>
        <template v-else-if="searchIndexing && searchIndexingProgress">
          Building search index… {{ searchIndexingProgress.current }} / {{ searchIndexingProgress.total }}
        </template>
        <template v-else-if="searchIndexing">Building search index…</template>
        <template v-else-if="indexingProgress">
          Indexing sessions… {{ indexingProgress.current }} / {{ indexingProgress.total }}
        </template>
        <template v-else>Indexing sessions…</template>
      </span>
      <div v-if="searchIndexingProgress && searchIndexingProgress.total > 0" class="indexing-banner-bar-container">
        <div
          class="indexing-banner-bar"
          :style="{ width: (searchIndexingProgress.current / searchIndexingProgress.total * 100) + '%' }"
        />
      </div>
      <div v-else-if="indexingProgress && indexingProgress.total > 0" class="indexing-banner-bar-container">
        <div
          class="indexing-banner-bar"
          :style="{ width: (indexingProgress.current / indexingProgress.total * 100) + '%' }"
        />
      </div>
    </div>
  </div>
</template>
