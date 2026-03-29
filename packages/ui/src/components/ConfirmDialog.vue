<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import ModalDialog from "./ModalDialog.vue";
import { useConfirmDialog, type ConfirmVariant } from "../composables/useConfirmDialog";

const { options, visible, resolve } = useConfirmDialog();

const checked = ref(false);
const cancelBtnRef = ref<HTMLButtonElement | null>(null);

// Reset checkbox & focus Cancel button each time the dialog opens.
watch(visible, async (open) => {
  if (open) {
    checked.value = false;
    await nextTick();
    cancelBtnRef.value?.focus();
  }
});

function handleCancel() {
  resolve({ confirmed: false, checked: false });
}

function handleConfirm() {
  resolve({ confirmed: true, checked: checked.value });
}

function handleVisibleUpdate(val: boolean) {
  if (!val) handleCancel();
}

const variantIcon: Record<ConfirmVariant, string> = {
  danger: "🗑",
  warning: "⚠",
  info: "ℹ",
};

function variantClass(v?: ConfirmVariant): string {
  return `confirm--${v ?? "info"}`;
}
</script>

<template>
  <ModalDialog
    :visible="visible"
    :title="options?.title"
    role="alertdialog"
    @update:visible="handleVisibleUpdate"
  >
    <template #header>
      <div class="confirm-header" :class="variantClass(options?.variant)">
        <span class="confirm-icon" aria-hidden="true">{{
          variantIcon[options?.variant ?? "info"]
        }}</span>
        <h3>{{ options?.title }}</h3>
      </div>
    </template>

    <div
      class="confirm-body"
      :class="variantClass(options?.variant)"
    >
      <p class="confirm-message">{{ options?.message }}</p>

      <label v-if="options?.checkbox" class="confirm-checkbox">
        <input type="checkbox" v-model="checked" />
        {{ options.checkbox }}
      </label>
    </div>

    <template #footer>
      <div class="confirm-footer" :class="variantClass(options?.variant)">
        <button
          ref="cancelBtnRef"
          class="btn btn-secondary"
          @click="handleCancel"
        >
          {{ options?.cancelLabel ?? "Cancel" }}
        </button>
        <button
          class="btn btn-confirm"
          :class="variantClass(options?.variant)"
          @click="handleConfirm"
        >
          {{ options?.confirmLabel ?? "Confirm" }}
        </button>
      </div>
    </template>
  </ModalDialog>
</template>

<style scoped>
/* ── Entrance animation ──────────────────────────────────────── */
:deep(.modal) {
  max-width: 440px;
  animation: confirm-enter 0.15s ease-out;
}

@keyframes confirm-enter {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  :deep(.modal) {
    animation: none;
  }
}

/* ── Header ──────────────────────────────────────────────────── */
.confirm-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.confirm-header h3 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
}

.confirm-icon {
  font-size: 1.25rem;
  line-height: 1;
}

/* ── Body ────────────────────────────────────────────────────── */
.confirm-body {
  border-left: 3px solid var(--accent-muted);
  padding-left: 0.75rem;
}

.confirm-body.confirm--danger {
  border-left-color: var(--danger-muted);
}

.confirm-body.confirm--warning {
  border-left-color: var(--warning-muted);
}

.confirm-body.confirm--info {
  border-left-color: var(--accent-muted);
}

.confirm-message {
  margin: 0 0 0.75rem;
  line-height: 1.5;
}

/* ── Checkbox ────────────────────────────────────────────────── */
.confirm-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  cursor: pointer;
  user-select: none;
}

.confirm-checkbox input[type="checkbox"] {
  margin: 0;
}

/* ── Footer ──────────────────────────────────────────────────── */
.confirm-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

/* ── Confirm button variant colors ───────────────────────────── */
.btn-confirm {
  color: #fff;
  border: none;
  padding: 0.4rem 1rem;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

.btn-confirm.confirm--danger {
  background-color: var(--danger-emphasis);
}

.btn-confirm.confirm--danger:hover {
  background-color: var(--danger-fg);
}

.btn-confirm.confirm--warning {
  background-color: var(--warning-emphasis);
}

.btn-confirm.confirm--warning:hover {
  background-color: var(--warning-fg);
}

.btn-confirm.confirm--info {
  background-color: var(--accent-emphasis);
}

.btn-confirm.confirm--info:hover {
  background-color: var(--accent-fg);
}

/* ── Secondary (Cancel) button ───────────────────────────────── */
.btn-secondary {
  background: transparent;
  border: 1px solid var(--border-default, #444);
  color: var(--text-primary, #ccc);
  padding: 0.4rem 1rem;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
}

.btn-secondary:hover {
  background-color: var(--canvas-subtle, rgba(255, 255, 255, 0.06));
}
</style>
