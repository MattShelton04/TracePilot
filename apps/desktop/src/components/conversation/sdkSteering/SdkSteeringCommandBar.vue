<script setup lang="ts">
import { useSdkSteeringContext } from "@/composables/useSdkSteering";

const ctx = useSdkSteeringContext();
</script>

<template>
  <div class="cb-bar">
    <!-- Top row: status dot + input + actions -->
    <div class="cb-main">
      <div class="cb-status-dot-wrap" :title="`SDK: ${ctx.sdk.connectionState}`">
        <span :class="['cb-status-dot', `cb-dot--${ctx.sdk.connectionState}`]" />
      </div>

      <div class="cb-input-wrap">
        <textarea
          :ref="ctx.setInputEl"
          v-model="ctx.prompt"
          class="cb-input"
          placeholder="Send a message to steer the session…"
          rows="1"
          :disabled="ctx.sending"
          @keydown="ctx.handleKeydown"
        />
      </div>

      <div class="cb-actions">
        <button
          :class="['cb-btn-abort', { visible: ctx.sending }]"
          title="Abort session"
          @click="ctx.handleAbort"
        >
          <svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5" /></svg>
        </button>

        <button
          :class="['cb-btn-send', { 'has-text': ctx.hasText }]"
          :disabled="!ctx.hasText || ctx.sending"
          title="Send (Ctrl+Enter)"
          @click="ctx.handleSend"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 12V4" /><path d="M4 8l4-4 4 4" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Toolbar: mode pills + model selector + kbd hint -->
    <div class="cb-toolbar">
      <div class="cb-mode-pills">
        <button
          v-for="m in ctx.modes"
          :key="m.value"
          :class="['cb-mode-pill', { active: ctx.currentMode === m.value }]"
          :title="m.label"
          @click="ctx.handleModeChange(m.value)"
        >
          <span class="cb-pill-emoji">{{ m.icon }}</span>
          <span>{{ m.label }}</span>
        </button>
      </div>

      <div
        class="cb-model-selector"
        :title="'Model is set when linking. Unlink and re-link to change it.'"
      >
        <span class="cb-model-btn disabled">
          <span class="cb-model-name">{{ ctx.currentModel ?? 'model' }}</span>
        </span>
      </div>

      <span class="cb-kbd-hint">
        <kbd class="cb-kbd">Ctrl</kbd>
        <kbd class="cb-kbd">↵</kbd>
      </span>
    </div>
  </div>
</template>
