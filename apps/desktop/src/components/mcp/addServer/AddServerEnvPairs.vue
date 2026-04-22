<script setup lang="ts">
import type { AddServerForm } from "./useAddServerForm";

defineProps<{ form: AddServerForm }>();

defineEmits<{
  addPair: [];
  removePair: [index: number];
}>();
</script>

<template>
  <div class="form-group">
    <label class="form-label">Environment Variables <span class="form-label-optional">(optional)</span></label>
    <div class="env-rows">
      <div v-for="(pair, idx) in form.envPairs" :key="idx" class="env-row-modal">
        <input
          v-model="pair.key"
          type="text"
          class="form-input-modal env-key-input"
          placeholder="KEY"
        />
        <input
          v-model="pair.value"
          type="text"
          class="form-input-modal"
          placeholder="Value"
        />
        <button class="env-remove-btn" type="button" title="Remove" @click="$emit('removePair', idx)">✕</button>
      </div>
    </div>
    <button class="env-add-btn" type="button" title="Add variable" @click="$emit('addPair')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
    </button>
  </div>
</template>
