<script setup lang="ts">
import type { ConversationTurn, TaskNotification } from "@tracepilot/types";
import { truncateText } from "@tracepilot/ui";
import { ChevronLeft, ChevronRight, SkipBack, SkipForward } from "lucide-vue-next";
import { type ComponentPublicInstance, computed, nextTick, ref, watch } from "vue";
import { promptPreviewText } from "@/utils/pastedContent";

interface TurnStats {
  /** Display name; `modelId` is the recorded id. */
  model: string;
  modelId: string;
  duration: string;
  toolCount: number;
  agentCount: number;
}

const props = defineProps<{
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
  (e: "close-jump"): void;
  (e: "register-jump-ref", el: HTMLElement | null): void;
}>();

const jumpWrapper = ref<HTMLElement | null>(null);
const jumpToggle = ref<HTMLButtonElement | null>(null);
const jumpListEl = ref<HTMLElement | null>(null);

function setJumpRef(el: Element | ComponentPublicInstance | null) {
  jumpWrapper.value = (el as HTMLElement | null) ?? null;
  emit("register-jump-ref", jumpWrapper.value);
}

function jumpOptions(): HTMLElement[] {
  return Array.from(jumpListEl.value?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
}

// Opening the list moves focus to the current turn's option, so the arrow
// keys work from there and a long list scrolls to it.
watch(
  () => props.jumpOpen,
  async (open) => {
    if (!open) return;
    await nextTick();
    jumpOptions()[props.turnIndex]?.focus();
  },
);

// Picking a turn closes the list and removes the focused option; focus goes
// back to the toggle so the arrow keys keep moving between turns.
function pick(index: number) {
  jumpToggle.value?.focus();
  emit("jump-to", index);
}

function closeJump() {
  jumpToggle.value?.focus();
  emit("close-jump");
}

function onJumpKeydown(e: KeyboardEvent) {
  if (!props.jumpOpen) return;
  if (e.key === "Escape") {
    // Handled here so the view's Escape (dismiss the detail panel) waits.
    e.stopPropagation();
    closeJump();
    return;
  }
  const options = jumpOptions();
  const current = options.indexOf(document.activeElement as HTMLElement);
  if (current === -1) return;
  const next =
    e.key === "ArrowDown"
      ? Math.min(current + 1, options.length - 1)
      : e.key === "ArrowUp"
        ? Math.max(current - 1, 0)
        : e.key === "Home"
          ? 0
          : e.key === "End"
            ? options.length - 1
            : null;
  if (next === null) return;
  e.preventDefault();
  options[next].focus();
}

// Tabbing out of the open list closes it (clicks elsewhere are handled by the view).
function onJumpFocusOut(e: FocusEvent) {
  const to = e.relatedTarget as Node | null;
  if (props.jumpOpen && to && !jumpWrapper.value?.contains(to)) emit("close-jump");
}

const NOTIFICATION_KIND: Record<TaskNotification["kind"], string> = {
  agent: "Agent",
  shell: "Background shell",
  monitor: "Monitor",
};

interface TurnPreview {
  text: string;
  /** True when the text is the user's prompt rather than a stand-in for it. */
  isPrompt: boolean;
}

/**
 * What a turn is about: the user's prompt; else the background tasks whose
 * completion opened it; else the main agent's first reply (a follow-up turn
 * such as "Done."). Whitespace is collapsed for one-line display.
 */
function turnPreview(turn: ConversationTurn): TurnPreview {
  const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
  const prompt = turn.userMessage ? oneLine(promptPreviewText(turn.userMessage)) : "";
  if (prompt) return { text: prompt, isPrompt: true };
  const notes = turn.notifications ?? [];
  if (notes.length > 0) {
    const what = notes
      .map(
        (n) => oneLine(n.summary ?? "") || `${NOTIFICATION_KIND[n.kind]} ${n.status ?? "finished"}`,
      )
      .join("; ");
    return { text: `Notification: ${what}`, isPrompt: false };
  }
  const reply = turn.assistantMessages.find((m) => !m.parentToolCallId && m.content.trim());
  if (reply) return { text: `Assistant: ${oneLine(reply.content)}`, isPrompt: false };
  return { text: "(no message)", isPrompt: false };
}

// Read only while the jump list is open.
const jumpItems = computed(() =>
  props.turns.map((t) => ({ turnIndex: t.turnIndex, preview: turnPreview(t) })),
);
const currentPreview = computed(() => (props.currentTurn ? turnPreview(props.currentTurn) : null));
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
          <SkipBack :size="14" aria-hidden="true" /> Earliest
        </button>
        <button
          class="nav-btn"
          :disabled="!canPrev"
          @click="emit('prev')"
          aria-label="Previous turn"
        >
          <ChevronLeft :size="14" aria-hidden="true" /> Prev
        </button>
        <span class="nav-label">{{ turnLabel }}</span>
        <button
          class="nav-btn"
          :disabled="!canNext"
          @click="emit('next')"
          aria-label="Next turn"
        >
          Next <ChevronRight :size="14" aria-hidden="true" />
        </button>
        <button
          class="nav-btn"
          :disabled="!canNext"
          @click="emit('jump-to', turns.length - 1)"
          aria-label="Jump to latest turn"
        >
          Latest <SkipForward :size="14" aria-hidden="true" />
        </button>
      </div>

      <!-- Jump dropdown -->
      <div
        :ref="setJumpRef"
        class="jump-wrapper"
        @keydown="onJumpKeydown"
        @focusout="onJumpFocusOut"
      >
        <button
          ref="jumpToggle"
          class="nav-btn"
          @click.stop="emit('toggle-jump')"
          :aria-expanded="jumpOpen"
          aria-haspopup="listbox"
        >
          Jump to… ▾
        </button>
        <div v-if="jumpOpen" class="jump-dropdown">
          <div ref="jumpListEl" class="jump-list" role="listbox" aria-label="Jump to turn">
            <button
              v-for="(item, idx) in jumpItems"
              :key="idx"
              class="jump-item"
              :class="{ active: idx === turnIndex }"
              role="option"
              :aria-selected="idx === turnIndex"
              :tabindex="idx === turnIndex ? 0 : -1"
              @click="pick(idx)"
            >
              <span class="jump-idx">{{ item.turnIndex }}</span>
              <span class="jump-msg">
                {{ truncateText(item.preview.text, 60) }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Turn summary -->
    <div v-if="currentTurn && currentPreview" class="turn-summary">
      <div class="turn-message" :class="{ 'turn-message--stand-in': !currentPreview.isPrompt }">
        <template v-if="currentPreview.isPrompt">"{{ truncateText(currentPreview.text, 120) }}"</template>
        <template v-else>{{ truncateText(currentPreview.text, 120) }}</template>
      </div>
      <div class="turn-meta">
        <span v-if="turnStats.model" class="meta-chip" :title="turnStats.modelId">
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

<style scoped>
/* A stand-in for a missing prompt (a notification or the agent's reply) is not
   quoted like a prompt the user typed, and reads quieter. */
.turn-message--stand-in {
  color: var(--text-secondary);
  font-style: normal;
}
</style>
