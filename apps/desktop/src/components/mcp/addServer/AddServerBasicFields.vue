<script setup lang="ts">
import type { AddServerForm } from "./useAddServerForm";
import { transportOptions } from "./useAddServerForm";

defineProps<{ form: AddServerForm }>();
</script>

<template>
  <div class="form-group">
    <label class="form-label">Server Name</label>
    <input
      v-model="form.name"
      type="text"
      class="form-input-modal"
      placeholder="my-custom-server"
      required
    />
  </div>

  <div class="form-group">
    <label class="form-label">Transport Type</label>
    <div class="transport-pills">
      <button
        v-for="opt in transportOptions"
        :key="opt.value"
        class="transport-pill"
        :class="{ active: form.transport === opt.value }"
        type="button"
        :title="opt.tooltip"
        @click="form.transport = opt.value"
      >
        {{ opt.label }}
      </button>
    </div>
  </div>

  <template v-if="form.transport === 'stdio'">
    <div class="form-group">
      <label class="form-label">Command</label>
      <input
        v-model="form.command"
        type="text"
        class="form-input-modal"
        placeholder="npx, python, node…"
      />
    </div>
    <div class="form-group">
      <label class="form-label">Arguments</label>
      <textarea
        v-model="form.args"
        class="form-textarea-modal"
        placeholder="One argument per line"
        rows="2"
      />
    </div>
  </template>
  <template v-else>
    <div class="form-group">
      <label class="form-label">URL</label>
      <input
        v-model="form.url"
        type="text"
        class="form-input-modal"
        placeholder="http://localhost:3000/mcp"
      />
    </div>
  </template>
</template>
