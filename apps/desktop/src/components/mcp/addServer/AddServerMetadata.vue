<script setup lang="ts">
import { useId } from "vue";
import type { AddServerForm } from "./useAddServerForm";

defineProps<{ form: AddServerForm }>();
const id = useId();
</script>

<template>
  <div class="form-group">
    <label class="form-label" :for="`${id}-description`">Description <span class="form-label-optional">(optional)</span></label>
    <textarea
      :id="`${id}-description`"
      v-model="form.description"
      class="form-textarea-modal"
      placeholder="Optional description"
      rows="2"
    />
  </div>

  <div class="form-group">
    <label class="form-label" :for="`${id}-tags`">Tags <span class="form-label-optional">(comma-separated)</span></label>
    <input
      :id="`${id}-tags`"
      v-model="form.tags"
      type="text"
      class="form-input-modal"
      placeholder="e.g., filesystem, code"
    />
  </div>

  <p class="config-location-note">
    Saved in <code>mcp-config.json</code> in your configured Copilot home. This configuration applies globally.
  </p>
</template>
