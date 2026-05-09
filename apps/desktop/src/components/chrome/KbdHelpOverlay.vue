<script setup lang="ts">
import { Heading, ModalDialog } from "@tracepilot/ui";
import { computed, ref } from "vue";
import { groupedShortcuts, useShortcut } from "@/composables/useShortcut";

const visible = ref(false);

function open() {
  visible.value = true;
}
function close() {
  visible.value = false;
}

useShortcut(["?", "Mod+/"], open, {
  description: "Show keyboard shortcuts",
  group: "Global",
  ignoreEditable: true,
});

const groups = computed(() => groupedShortcuts());

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

function renderToken(token: string): string {
  switch (token) {
    case "Mod":
      return isMac ? "⌘" : "Ctrl";
    case "Shift":
      return isMac ? "⇧" : "Shift";
    case "Alt":
      return isMac ? "⌥" : "Alt";
    case "Ctrl":
      return isMac ? "⌃" : "Ctrl";
    case "Enter":
      return "↵";
    case "Escape":
      return "Esc";
    case "ArrowUp":
      return "↑";
    case "ArrowDown":
      return "↓";
    case "ArrowLeft":
      return "←";
    case "ArrowRight":
      return "→";
    default:
      return token;
  }
}

function tokenize(combo: string): string[] {
  return combo.split("+").map((t) => renderToken(t.trim()));
}
</script>

<template>
  <ModalDialog
    :visible="visible"
    title="Keyboard shortcuts"
    @update:visible="(v: boolean) => (v ? open() : close())"
  >
    <div class="kbd-help" @keydown.esc.stop="close">
      <p v-if="groups.length === 0" class="kbd-help-empty">
        No shortcuts registered for this view.
      </p>
      <section v-for="g in groups" :key="g.group" class="kbd-help-group">
        <Heading :level="3" size="sm" class="kbd-help-group-label">{{ g.group }}</Heading>
        <ul class="kbd-help-list">
          <li v-for="meta in g.items" :key="meta.id" class="kbd-help-row">
            <span class="kbd-help-desc">{{ meta.description }}</span>
            <span class="kbd-help-combos">
              <template v-for="(combo, ci) in meta.combos" :key="combo">
                <span v-if="ci > 0" class="kbd-help-or">or</span>
                <span class="kbd-help-combo">
                  <kbd
                    v-for="(token, ti) in tokenize(combo)"
                    :key="ti"
                    class="kbd-help-key"
                  >{{ token }}</kbd>
                </span>
              </template>
            </span>
          </li>
        </ul>
      </section>
    </div>
  </ModalDialog>
</template>

<style scoped>
.kbd-help {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: min(520px, 90vw);
  max-height: 60vh;
  overflow-y: auto;
}
.kbd-help-empty {
  margin: 0;
  font-size: 13px;
  line-height: 18px;
  color: var(--text-tertiary);
}
.kbd-help-group { display: flex; flex-direction: column; gap: 8px; }
.kbd-help-group-label { color: var(--text-tertiary); }
.kbd-help-list { margin: 0; padding: 0; list-style: none; }

.kbd-help-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 16px;
  padding: 6px 0;
  font-size: 13px;
  line-height: 18px;
  border-bottom: 1px solid var(--border-subtle);
}
.kbd-help-row:last-child { border-bottom: 0; }
.kbd-help-desc { color: var(--text-primary); }

.kbd-help-combos {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-tertiary);
}
.kbd-help-or { font-size: 11px; color: var(--text-tertiary); }
.kbd-help-combo { display: inline-flex; gap: 4px; }
.kbd-help-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  background: var(--canvas-default);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
}
</style>
