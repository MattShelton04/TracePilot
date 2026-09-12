<script setup lang="ts">
import { useId } from "vue";
import type { AddServerForm } from "./useAddServerForm";
import { transportOptions } from "./useAddServerForm";

defineProps<{ form: AddServerForm }>();
const id = useId();
</script>

<template>
  <div class="form-group">
    <label class="form-label" :for="`${id}-name`">Server Name</label>
    <input
      :id="`${id}-name`"
      v-model="form.name"
      type="text"
      class="form-input-modal"
      placeholder="my-custom-server"
      required
    />
  </div>

  <div class="form-group">
    <span :id="`${id}-transport`" class="form-label">Transport Type</span>
    <div class="transport-pills" role="group" :aria-labelledby="`${id}-transport`">
      <button
        v-for="opt in transportOptions"
        :key="opt.value"
        class="transport-pill"
        :class="{ active: form.transport === opt.value }"
        :aria-pressed="form.transport === opt.value"
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
      <label class="form-label" :for="`${id}-command`">Command</label>
      <input
        :id="`${id}-command`"
        v-model="form.command"
        type="text"
        class="form-input-modal"
        placeholder="npx, python, node…"
      />
    </div>
    <div class="form-group">
      <label class="form-label" :for="`${id}-args`">Arguments</label>
      <textarea
        :id="`${id}-args`"
        v-model="form.args"
        class="form-textarea-modal"
        placeholder="One argument per line"
        rows="2"
      />
    </div>
  </template>
  <template v-else>
    <div class="form-group">
      <label class="form-label" :for="`${id}-url`">URL</label>
      <input
        :id="`${id}-url`"
        v-model="form.url"
        type="text"
        class="form-input-modal"
        placeholder="http://localhost:3000/mcp"
      />
    </div>
  </template>
</template>
