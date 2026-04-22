<script setup lang="ts">
import { truncateText } from "@tracepilot/ui";

type Variant = "user" | "assistant";

const props = defineProps<{
  variant: Variant;
  turnIndex: number;
  /** Full message content to display when expanded. */
  content: string;
  /** Number of available assistant messages (for pagination). 1 or undefined disables nav. */
  messageCount?: number;
  /** Current paginated index (assistant variant only). */
  currentIndex?: number;
  expanded: boolean;
}>();

const emit = defineEmits<{
  (e: "toggle-expanded"): void;
  (e: "set-index", idx: number): void;
}>();

const LABEL_BY_VARIANT: Record<Variant, string> = {
  user: "User",
  assistant: "Assistant",
};

const COLLAPSED_WIDTH: Record<Variant, string> = {
  user: "30%",
  assistant: "80%",
};

const TRUNCATE_AT: Record<Variant, number> = {
  user: 50,
  assistant: 80,
};

function prev() {
  if (props.currentIndex != null && props.currentIndex > 0) {
    emit("set-index", props.currentIndex - 1);
  }
}

function next() {
  if (
    props.currentIndex != null &&
    props.messageCount != null &&
    props.currentIndex < props.messageCount - 1
  ) {
    emit("set-index", props.currentIndex + 1);
  }
}
</script>

<template>
  <div class="swimlane">
    <div class="swimlane-label">{{ LABEL_BY_VARIANT[variant] }}</div>
    <div class="swimlane-track">
      <!-- Collapsed bar -->
      <div
        v-if="!expanded"
        class="swimlane-bar swimlane-bar--expandable"
        :class="{
          'swimlane-bar--user': variant === 'user',
          'swimlane-bar--assistant': variant === 'assistant',
        }"
        :style="{ width: COLLAPSED_WIDTH[variant] }"
        :title="variant === 'user' ? content : content.slice(0, 200)"
        role="button"
        tabindex="0"
        :aria-label="
          variant === 'user'
            ? `Expand user message: ${truncateText(content, 50)}`
            : 'Expand assistant message'
        "
        @click="emit('toggle-expanded')"
        @keydown.enter.space.prevent="emit('toggle-expanded')"
      >
        {{ truncateText(content, TRUNCATE_AT[variant]) }}
        <span v-if="content.length > TRUNCATE_AT[variant]" class="expand-hint">⤢</span>
      </div>
      <!-- Expanded content -->
      <div
        v-else
        class="swimlane-expanded"
        :class="{
          'swimlane-expanded--user': variant === 'user',
          'swimlane-expanded--assistant': variant === 'assistant',
        }"
      >
        <template v-if="variant === 'user'">
          <button class="swimlane-collapse-btn" @click="emit('toggle-expanded')">
            ▾ Collapse
          </button>
          <div class="swimlane-expanded-content">{{ content }}</div>
        </template>
        <template v-else>
          <div class="swimlane-expanded-header">
            <button class="swimlane-collapse-btn" @click="emit('toggle-expanded')">
              ▾ Collapse
            </button>
            <div v-if="messageCount != null && messageCount > 1" class="msg-pagination">
              <button
                class="msg-nav-btn"
                :disabled="(currentIndex ?? 0) <= 0"
                title="Previous message"
                @click="prev"
              >
                ‹
              </button>
              <span class="msg-nav-label">
                {{ (currentIndex ?? 0) + 1 }} / {{ messageCount }}
              </span>
              <button
                class="msg-nav-btn"
                :disabled="(currentIndex ?? 0) >= messageCount - 1"
                title="Next message"
                @click="next"
              >
                ›
              </button>
            </div>
          </div>
          <div class="swimlane-expanded-content">{{ content }}</div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.swimlane {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 0;
}

.swimlane-label {
  padding: 6px 12px;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
}

.swimlane-track {
  padding: 6px 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  overflow: hidden;
  flex-wrap: wrap;
}

.swimlane-bar {
  height: 22px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  font-size: 0.625rem;
  font-weight: 500;
  color: white;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
  transition: opacity var(--transition-fast), box-shadow var(--transition-fast);
  cursor: default;
}

.swimlane-bar:hover {
  opacity: 0.85;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
}

.swimlane-bar--user {
  background: var(--accent-fg);
}

.swimlane-bar--assistant {
  background: var(--success-fg);
}

.swimlane-bar.swimlane-bar--expandable {
  cursor: pointer;
  transition: filter 0.15s ease;
}

.swimlane-bar.swimlane-bar--expandable:hover {
  filter: brightness(1.15);
}

.expand-hint {
  margin-left: 6px;
  font-size: 0.75rem;
  opacity: 0.7;
  flex-shrink: 0;
}

.swimlane-expanded {
  width: 100%;
  padding: 8px 12px;
  background: var(--canvas-subtle);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.swimlane-expanded--user {
  border-left: 3px solid var(--accent-fg);
}

.swimlane-expanded--assistant {
  border-left: 3px solid var(--success-fg);
}

.swimlane-expanded-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.swimlane-expanded-content {
  font-size: 0.75rem;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
  font-family: var(--font-mono, monospace);
  line-height: 1.5;
}

.msg-pagination {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.msg-nav-btn {
  border: none;
  background: var(--canvas-overlay, rgba(255, 255, 255, 0.06));
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  line-height: 1;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.msg-nav-btn:hover:not(:disabled) {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}

.msg-nav-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.msg-nav-label {
  font-size: 0.625rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  min-width: 32px;
  text-align: center;
}

.swimlane-collapse-btn {
  align-self: flex-start;
  border: none;
  background: none;
  color: var(--text-tertiary);
  font-size: 0.625rem;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast), color var(--transition-fast);
}

.swimlane-collapse-btn:hover {
  background: var(--canvas-overlay);
  color: var(--text-primary);
}
</style>
