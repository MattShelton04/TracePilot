<script setup lang="ts">
import { useId } from "vue";
import { useSessionLauncherContext } from "@/composables/useSessionLauncher";

const { prompt, clearTemplateSelection } = useSessionLauncherContext();
const promptId = `launcher-prompt-${useId()}`;
</script>

<template>
  <section class="section-block">
    <h2 class="section-label"><label :for="promptId">Initial Prompt</label></h2>
    <div class="section-panel">
      <textarea
        :id="promptId"
        v-model="prompt"
        class="form-input form-textarea"
        rows="4"
        placeholder="Describe the task…"
        :aria-describedby="`${promptId}-hint`"
        @input="clearTemplateSelection"
      />
      <span :id="`${promptId}-hint`" class="form-hint">Prompt will be passed to the CLI via <code>--interactive</code> and executed automatically on session start</span>
    </div>
  </section>
</template>
