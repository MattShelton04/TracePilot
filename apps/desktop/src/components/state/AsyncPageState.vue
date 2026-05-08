<script setup lang="ts">
import { EmptyState, ErrorState, LoadingSpinner } from "@tracepilot/ui";
import { computed } from "vue";

const props = defineProps<{
  loading: boolean;
  error: string | null | undefined;
  empty: boolean;
}>();

type Phase = "loading" | "error" | "empty" | "ready";

const phase = computed<Phase>(() => {
  if (props.loading) return "loading";
  if (props.error) return "error";
  if (props.empty) return "empty";
  return "ready";
});
</script>

<template>
  <div class="async-page-state" :data-phase="phase">
    <template v-if="phase === 'loading'">
      <slot name="loading">
        <div class="async-page-state__center">
          <LoadingSpinner size="md" />
        </div>
      </slot>
    </template>
    <template v-else-if="phase === 'error'">
      <slot name="error" :error="error">
        <div class="async-page-state__center">
          <ErrorState :message="error ?? undefined" :retryable="false" />
        </div>
      </slot>
    </template>
    <template v-else-if="phase === 'empty'">
      <slot name="empty">
        <div class="async-page-state__center">
          <EmptyState />
        </div>
      </slot>
    </template>
    <template v-else>
      <slot />
    </template>
  </div>
</template>

<style scoped>
.async-page-state {
  display: contents;
}
.async-page-state__center {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 24px;
}
</style>
