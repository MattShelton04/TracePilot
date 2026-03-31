import { onMounted, onUnmounted, ref } from "vue";

/**
 * Composable for resizable split-panel layout.
 * Returns reactive `leftWidth` (percentage) and mouse handlers.
 */
export function useResizeHandle(options?: {
  minPct?: number;
  maxPct?: number;
  initial?: number;
}) {
  const min = options?.minPct ?? 20;
  const max = options?.maxPct ?? 80;
  const leftWidth = ref(options?.initial ?? 50);
  const dragging = ref(false);
  const containerRef = ref<HTMLElement | null>(null);

  function onMouseDown(e: MouseEvent) {
    e.preventDefault();
    dragging.value = true;
  }

  function onMouseMove(e: MouseEvent) {
    if (!dragging.value || !containerRef.value) return;
    const rect = containerRef.value.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    leftWidth.value = Math.min(max, Math.max(min, pct));
  }

  function onMouseUp() {
    dragging.value = false;
  }

  onMounted(() => {
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  onUnmounted(() => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  });

  return {
    leftWidth,
    dragging,
    containerRef,
    onMouseDown,
  };
}
