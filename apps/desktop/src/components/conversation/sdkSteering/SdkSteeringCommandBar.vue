<script setup lang="ts">
import { computed } from "vue";
import { useSdkSteeringContext } from "@/composables/useSdkSteering";
import { useSdkLiveSessionContext } from "@/composables/useLiveSdkSession";

const ctx = useSdkSteeringContext();
const live = useSdkLiveSessionContext();

/** Use live model (from session.model_change events) if available, fall back to steering ctx. */
const displayModel = computed(() => live?.liveModel.value ?? ctx.currentModel ?? "model");

/** Token usage ratio 0–1, or null when unknown. */
const tokenRatio = computed(() => live?.tokenUsage.value?.ratio ?? null);
const tokenPct = computed(() => tokenRatio.value != null ? Math.round(tokenRatio.value * 100) : null);

/** Colour tier for the token meter. */
const tokenMeterClass = computed(() => {
  const r = tokenRatio.value;
  if (r == null) return "";
  if (r >= 0.85) return "danger";
  if (r >= 0.65) return "warning";
  return "ok";
});

/** Per-turn stats from the last assistant.usage event. */
const turnStats = computed(() => live?.lastTurnStats.value ?? null);

function formatDurationMs(ms: number | null): string {
  if (ms == null) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(n: number | null): string {
  if (n == null) return "?";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
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
          :disabled="ctx.sdk.sendingMessage"
          @keydown="ctx.handleKeydown"
        />
      </div>

      <div class="cb-actions">
        <button
          :class="['cb-btn-abort', { visible: ctx.sdk.sendingMessage || live?.isAgentRunning.value }]"
          title="Abort session"
          @click="ctx.handleAbort"
        >
          <svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5" /></svg>
        </button>

        <button
          :class="['cb-btn-send', { 'has-text': ctx.hasText }]"
          :disabled="!ctx.hasText || ctx.sdk.sendingMessage"
          title="Send (Ctrl+Enter)"
          @click="ctx.handleSend"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 12V4" /><path d="M4 8l4-4 4 4" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Toolbar: mode pills + model selector + token meter + kbd hint -->
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
          <span class="cb-model-name">{{ displayModel }}</span>
        </span>
      </div>

      <!-- Token budget meter (shown when session.usage_info has been received) -->
      <div
        v-if="tokenPct != null"
        class="cb-token-meter"
        :title="`Context: ${tokenPct}% used`"
      >
        <div class="cb-token-track">
          <div
            :class="['cb-token-fill', `cb-token--${tokenMeterClass}`]"
            :style="{ width: `${tokenPct}%` }"
          />
        </div>
        <span :class="['cb-token-label', `cb-token--${tokenMeterClass}`]">{{ tokenPct }}%</span>
      </div>

      <!-- Per-turn stats chip (shown briefly after each turn completes) -->
      <div v-if="turnStats" class="cb-turn-stats" :title="`in:${formatTokens(turnStats.inputTokens)} out:${formatTokens(turnStats.outputTokens)} · ${formatDurationMs(turnStats.durationMs)}`">
        <span class="cb-turn-stat">{{ formatTokens(turnStats.outputTokens) }} tok</span>
        <span v-if="turnStats.durationMs != null" class="cb-turn-stat">{{ formatDurationMs(turnStats.durationMs) }}</span>
      </div>

      <span class="cb-kbd-hint">
        <kbd class="cb-kbd">Ctrl</kbd>
        <kbd class="cb-kbd">↵</kbd>
      </span>
    </div>
  </div>
</template>
