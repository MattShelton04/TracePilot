import { computed, onMounted, onUnmounted, ref, watch } from "vue";

/** Resizable split panels with pixel-aware bounds and keyboard control. */
export function useResizeHandle(options?: {
  minPct?: number;
  maxPct?: number;
  initial?: number;
  minPanePx?: number;
  splitterPx?: number;
}) {
  const initial = options?.initial ?? 50;
  const leftWidth = ref(initial);
  const dragging = ref(false);
  const containerRef = ref<HTMLElement | null>(null);
  const containerWidth = ref(0);
  const bounds = computed(() => {
    const width = containerWidth.value;
    const min = options?.minPct ?? 20;
    const max = options?.maxPct ?? 80;
    if (!width) return { min, max };
    const available = Math.max(0, width - (options?.splitterPx ?? 0));
    const paneMin = Math.min(options?.minPanePx ?? 0, available / 2);
    const lower = Math.max(min, (paneMin / width) * 100);
    const upper = Math.min(max, ((available - paneMin) / width) * 100);
    // If the container cannot fit both requested minima, share its available space.
    return lower <= upper
      ? { min: lower, max: upper }
      : {
          min: (available / width) * 50,
          max: (available / width) * 50,
        };
  });
  const minLeftWidth = computed(() => bounds.value.min);
  const maxLeftWidth = computed(() => bounds.value.max);

  function setWidth(value: number) {
    leftWidth.value = Math.min(maxLeftWidth.value, Math.max(minLeftWidth.value, value));
  }

  function measure() {
    containerWidth.value = containerRef.value?.getBoundingClientRect().width ?? 0;
    setWidth(leftWidth.value);
  }

  function stopDragging() {
    dragging.value = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", stopDragging);
    window.removeEventListener("blur", stopDragging);
  }

  function onMouseDown(event: MouseEvent) {
    if (event.button !== 0 || !containerRef.value) return;
    measure();
    if (!containerWidth.value) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement | null)?.focus();
    dragging.value = true;
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", stopDragging);
    window.addEventListener("blur", stopDragging);
  }

  function onMouseMove(event: MouseEvent) {
    if (!dragging.value || !containerRef.value) return;
    const rect = containerRef.value.getBoundingClientRect();
    if (!rect.width) return;
    containerWidth.value = rect.width;
    setWidth(((event.clientX - rect.left) / rect.width) * 100);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) return;
    measure();
    if (!containerWidth.value) return;
    event.preventDefault();
    const step = ((event.shiftKey ? 64 : 16) / containerWidth.value) * 100;
    if (event.key === "Home") setWidth(minLeftWidth.value);
    else if (event.key === "End") setWidth(maxLeftWidth.value);
    else if (event.key === "Enter") setWidth(initial);
    else setWidth(leftWidth.value + (event.key === "ArrowLeft" ? -step : step));
  }

  let observer: ResizeObserver | undefined;
  watch(
    containerRef,
    (element) => {
      stopDragging();
      observer?.disconnect();
      measure();
      if (element && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(measure);
        observer.observe(element);
      }
    },
    { flush: "post" },
  );
  onMounted(() => window.addEventListener("resize", measure));
  onUnmounted(() => {
    stopDragging();
    observer?.disconnect();
    window.removeEventListener("resize", measure);
  });

  return { leftWidth, minLeftWidth, maxLeftWidth, dragging, containerRef, onMouseDown, onKeyDown };
}
