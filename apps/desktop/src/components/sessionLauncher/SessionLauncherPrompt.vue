<script setup lang="ts">
import { useSessionLauncherContext } from "@/composables/useSessionLauncher";

const { prompt, clearTemplateSelection } = useSessionLauncherContext();
</script>

<template>
  <section class="section-block">
    <h2 class="section-label">Initial Prompt</h2>
    <div class="section-panel">
      <textarea
        v-model="prompt"
        class="form-input form-textarea"
        rows="4"
        placeholder="Describe the task…"
        @input="clearTemplateSelection"
      />
      <span class="form-hint">Prompt will be passed to the CLI via <code>--interactive</code> and executed automatically on session start</span>
    </div>
  </section>
</template>
