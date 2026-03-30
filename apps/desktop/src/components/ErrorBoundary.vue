<script setup lang="ts">
import { onErrorCaptured, ref } from "vue";
import { logError } from "@/utils/logger";

const error = ref<Error | null>(null);
const errorInfo = ref<string>("");

onErrorCaptured((err: Error, _instance, info) => {
  error.value = err;
  errorInfo.value = info;
  const msg = `[ErrorBoundary] ${err.message} (${info})`;
  logError(msg, err);
  return false; // prevent propagation
});

function retry() {
  error.value = null;
  errorInfo.value = "";
}
</script>

<template>
  <div v-if="error" class="error-boundary">
    <div class="section-panel">
      <div class="section-panel-header">
        <h3 style="color: var(--danger-fg);">Something went wrong</h3>
      </div>
      <div class="section-panel-body">
        <p style="color: var(--text-secondary); margin-bottom: 12px;">
          {{ error.message }}
        </p>
        <p v-if="errorInfo" style="color: var(--text-tertiary); font-size: 0.8125rem; margin-bottom: 16px;">
          Error occurred in: {{ errorInfo }}
        </p>
        <button class="btn btn-primary" @click="retry">
          Try Again
        </button>
      </div>
    </div>
  </div>
  <slot v-else />
</template>

<style scoped>
.error-boundary {
  padding: 28px;
  max-width: 600px;
  margin: 0 auto;
}
</style>
