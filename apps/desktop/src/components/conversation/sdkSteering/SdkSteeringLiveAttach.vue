<script setup lang="ts">
/**
 * Live attach card (ADR-0016), shown when the open session is running in a
 * terminal but TracePilot is not attached:
 *   - attachable (`--ui-server`): offer "Watch live";
 *   - running without a server: explain how to restart it attachably.
 */
import { useClipboard } from "@tracepilot/ui";
import { Check, Copy, Radio, TerminalSquare } from "lucide-vue-next";
import { computed } from "vue";
import { useSdkSteeringContext } from "@/composables/useSdkSteering";
import { usePreferencesStore } from "@/stores/preferences";

const ctx = useSdkSteeringContext();
const prefs = usePreferencesStore();
const { copy, copied } = useClipboard();

const attachable = computed(() => ctx.liveHost?.state === "attachable");
const restartCommand = computed(
  () => `${prefs.cliCommand || "copilot"} --resume ${ctx.liveHost?.sessionId ?? ""} --ui-server`,
);
</script>

<template>
  <div class="cb-link-prompt live-attach" :class="{ 'is-attachable': attachable }" data-testid="live-attach-card">
    <div class="live-attach-row">
      <span class="live-attach-icon" aria-hidden="true">
        <Radio v-if="attachable" :size="16" />
        <TerminalSquare v-else :size="16" />
      </span>
      <div class="cb-link-info">
        <div class="cb-link-title">
          {{ attachable ? "Running in a terminal" : "Running in a terminal without live access" }}
        </div>
        <div class="cb-link-desc">
          <template v-if="attachable">
            Watch replies, reasoning and tool output stream in as they happen. Prompts and
            permission requests stay in the terminal.
          </template>
          <template v-else>
            This terminal was started without <code>--ui-server</code>, so TracePilot can only show
            what has been saved so far. To watch it live, exit it and resume it with:
          </template>
        </div>
      </div>
      <button
        v-if="attachable"
        type="button"
        class="cb-btn-link"
        :disabled="ctx.attaching"
        data-testid="live-attach-button"
        @click="ctx.attachLive"
      >
        <svg v-if="ctx.attaching" class="cb-spin" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="28" stroke-dashoffset="8" />
        </svg>
        <Radio v-else :size="14" aria-hidden="true" />
        {{ ctx.attaching ? "Attaching…" : "Watch live" }}
      </button>
    </div>
    <div v-if="!attachable" class="live-attach-command">
      <code>{{ restartCommand }}</code>
      <button
        type="button"
        class="live-attach-copy"
        :aria-label="copied ? 'Copied' : 'Copy command'"
        :title="copied ? 'Copied' : 'Copy command'"
        @click="copy(restartCommand)"
      >
        <Check v-if="copied" :size="13" />
        <Copy v-else :size="13" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.live-attach-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.live-attach-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  background: var(--neutral-subtle);
  color: var(--text-tertiary);
}
.is-attachable .live-attach-icon {
  background: var(--success-muted);
  color: var(--success-fg);
}
.live-attach .cb-btn-link {
  flex-shrink: 0;
}
.cb-link-desc code {
  font-family: var(--font-mono);
  font-size: 0.95em;
}
.live-attach-command {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-inset, var(--neutral-subtle));
}
.live-attach-command code {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--text-primary);
}
.live-attach-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}
.live-attach-copy:hover {
  color: var(--text-primary);
  border-color: var(--border-default);
}
.live-attach-copy:focus-visible,
.live-attach .cb-btn-link:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: 2px;
}
</style>
