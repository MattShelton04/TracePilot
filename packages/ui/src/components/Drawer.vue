<script setup lang="ts">
import { X } from "lucide-vue-next";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

/**
 * Side-mounted drawer primitive.
 *
 * Sibling to {@link ModalDialog}. ModalDialog is centered + always modal;
 * Drawer slides in from the side. We keep them as separate primitives so
 * each retains a focused API rather than ModalDialog growing a placement
 * prop and conditional layout.
 */
const props = withDefaults(
  defineProps<{
    visible: boolean;
    /** Side to anchor the drawer panel. Defaults to `right`. */
    placement?: "right" | "left";
    /** Drawer width in CSS units. Defaults to `400px`. */
    width?: string;
    /** Accessible label, surfaced via `aria-label`. */
    title?: string;
    /**
     * Whether the drawer traps focus and dims content with a scrim.
     * Defaults to `true`. When `false`, behaves as a non-modal popover —
     * Esc still closes, but focus is not trapped.
     */
    modal?: boolean;
  }>(),
  {
    placement: "right",
    width: "400px",
    modal: true,
  },
);

const emit = defineEmits<{
  "update:visible": [value: boolean];
}>();

const overlayRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

function close() {
  emit("update:visible", false);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && props.visible) {
    const overlays = document.querySelectorAll(".drawer-overlay, .modal-overlay");
    if (overlays.length === 0 || overlays[overlays.length - 1] === overlayRef.value) {
      e.preventDefault();
      close();
    }
  }
}

const panelStyle = computed(() => ({ width: props.width, maxWidth: "90vw" }));

watch(
  () => props.visible,
  (v) => {
    if (v) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      nextTick(() => {
        panelRef.value?.focus();
      });
    } else if (previouslyFocused) {
      const el = previouslyFocused;
      previouslyFocused = null;
      nextTick(() => el.focus?.());
    }
  },
);

onMounted(() => document.addEventListener("keydown", onKeydown));
onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div
        v-if="visible"
        ref="overlayRef"
        class="drawer-overlay"
        :class="[`drawer-overlay--${placement}`, { 'drawer-overlay--modal': modal }]"
        @mousedown.self="close"
      >
        <aside
          ref="panelRef"
          class="drawer-panel"
          :class="[`drawer-panel--${placement}`]"
          :style="panelStyle"
          role="dialog"
          :aria-modal="modal"
          :aria-label="title"
          tabindex="-1"
        >
          <header v-if="title || $slots.header" class="drawer-header">
            <slot name="header">
              <h2 class="drawer-title">{{ title }}</h2>
            </slot>
            <button
              type="button"
              class="drawer-close"
              aria-label="Close"
              @click="close"
            >
              <X :size="14" :stroke-width="1.5" aria-hidden="true" />
            </button>
          </header>
          <div class="drawer-body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="drawer-footer">
            <slot name="footer" />
          </footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  display: flex;
}
.drawer-overlay--right { justify-content: flex-end; }
.drawer-overlay--left  { justify-content: flex-start; }
.drawer-overlay--modal {
  background: rgba(0, 0, 0, 0.45);
}

.drawer-panel {
  height: 100%;
  background: var(--canvas-raised);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
  outline: none;
}
.drawer-panel--right { border-left: 1px solid var(--border-subtle); }
.drawer-panel--left  { border-right: 1px solid var(--border-subtle); }

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.drawer-title {
  margin: 0;
  font-size: 16px;
  line-height: 22px;
  font-weight: 600;
  color: var(--text-primary);
}
.drawer-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}
.drawer-close:hover {
  color: var(--text-primary);
  background: var(--surface-tertiary);
}
.drawer-close:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}

.drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.drawer-footer {
  flex-shrink: 0;
  padding: 12px 20px;
  border-top: 1px solid var(--border-subtle);
}

@media (prefers-reduced-motion: no-preference) {
  .drawer-enter-active,
  .drawer-leave-active {
    transition: opacity 180ms cubic-bezier(0.2, 0.6, 0.2, 1);
  }
  .drawer-enter-active .drawer-panel,
  .drawer-leave-active .drawer-panel {
    transition: transform 220ms cubic-bezier(0.2, 0.6, 0.2, 1);
  }
  .drawer-enter-from,
  .drawer-leave-to {
    opacity: 0;
  }
  .drawer-enter-from .drawer-panel--right,
  .drawer-leave-to .drawer-panel--right {
    transform: translateX(100%);
  }
  .drawer-enter-from .drawer-panel--left,
  .drawer-leave-to .drawer-panel--left {
    transform: translateX(-100%);
  }
}
</style>
