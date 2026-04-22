<script setup lang="ts">
import type { ConversationTurn } from "@tracepilot/types";
import { truncateText } from "@tracepilot/ui";
import type { ComponentPublicInstance } from "vue";

interface TurnStats {
  model: string;
  duration: string;
  toolCount: number;
  agentCount: number;
}

defineProps<{
  turns: ConversationTurn[];
  turnIndex: number;
  turnLabel: string;
  canPrev: boolean;
  canNext: boolean;
  currentTurn: ConversationTurn | undefined;
  turnStats: TurnStats;
  jumpOpen: boolean;
}>();

const emit = defineEmits<{
  (e: "prev"): void;
  (e: "next"): void;
  (e: "jump-to", index: number): void;
  (e: "toggle-jump"): void;
  (e: "register-jump-ref", el: HTMLElement | null): void;
}>();

function setJumpRef(el: Element | ComponentPublicInstance | null) {
  emit("register-jump-ref", (el as HTMLElement | null) ?? null);
}
</script>

<template>
  <header class="waterfall-header">
    <div class="nav-row">
      <div class="nav-buttons">
        <button
          class="nav-btn"
          :disabled="!canPrev"
          @click="emit('jump-to', 0)"
          aria-label="Jump to earliest turn"
        >
          ⏮ Earliest
        </button>
        <button
          class="nav-btn"
          :disabled="!canPrev"
          @click="emit('prev')"
          aria-label="Previous turn"
        >
          ◀ Prev
        </button>
        <span class="nav-label">{{ turnLabel }}</span>
        <button
          class="nav-btn"
          :disabled="!canNext"
          @click="emit('next')"
          aria-label="Next turn"
        >
          Next ▶
        </button>
        <button
          class="nav-btn"
          :disabled="!canNext"
          @click="emit('jump-to', turns.length - 1)"
          aria-label="Jump to latest turn"
        >
          Latest ⏭
        </button>
      </div>

      <!-- Jump dropdown -->
      <div :ref="setJumpRef" class="jump-wrapper">
        <button
          class="nav-btn"
          @click.stop="emit('toggle-jump')"
          :aria-expanded="jumpOpen"
          aria-haspopup="listbox"
        >
          Jump to… ▾
        </button>
        <div v-if="jumpOpen" class="jump-dropdown">
          <div class="jump-list" role="listbox">
            <button
              v-for="(t, idx) in turns"
              :key="idx"
              class="jump-item"
              :class="{ active: idx === turnIndex }"
              role="option"
              :aria-selected="idx === turnIndex"
              @click="emit('jump-to', idx)"
            >
              <span class="jump-idx">{{ idx + 1 }}</span>
              <span class="jump-msg">
                {{ truncateText(t.userMessage ?? "(no message)", 60) }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Turn summary -->
    <div v-if="currentTurn" class="turn-summary">
      <div class="turn-message">
        "{{ truncateText(currentTurn.userMessage ?? "(no message)", 120) }}"
      </div>
      <div class="turn-meta">
        <span v-if="turnStats.model" class="meta-chip">
          Model: {{ turnStats.model }}
        </span>
        <span v-if="turnStats.duration" class="meta-chip">
          Duration: {{ turnStats.duration }}
        </span>
        <span class="meta-chip">
          Tools: {{ turnStats.toolCount }}
        </span>
        <span v-if="turnStats.agentCount > 0" class="meta-chip">
          Agents: {{ turnStats.agentCount }}
        </span>
      </div>
    </div>
  </header>
</template>
