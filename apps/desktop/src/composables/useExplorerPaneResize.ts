import { computed, onScopeDispose, type Ref, ref, watch } from "vue";

const MIN_TREE_WIDTH = 160;
const MAX_TREE_WIDTH = 500;
const DEFAULT_TREE_WIDTH = 240;
const MIN_VIEWER_WIDTH = 320;
const DIVIDER_WIDTH = 5;

/** Keep the file reader usable when a previously enlarged tree changes workspaces. */
export function useExplorerPaneResize(container: Ref<HTMLElement | null>) {
  const preferredWidth = ref(DEFAULT_TREE_WIDTH);
  const availableWidth = ref(Number.POSITIVE_INFINITY);
  const isDragging = ref(false);
  const maxTreeWidth = computed(() =>
    Math.max(
      MIN_TREE_WIDTH,
      Math.min(MAX_TREE_WIDTH, availableWidth.value - MIN_VIEWER_WIDTH - DIVIDER_WIDTH),
    ),
  );
  const treeWidth = computed(() => Math.min(preferredWidth.value, maxTreeWidth.value));
  const setWidth = (width: number) => {
    preferredWidth.value = Math.max(MIN_TREE_WIDTH, Math.min(maxTreeWidth.value, width));
  };

  let observer: ResizeObserver | undefined;
  watch(
    container,
    (element) => {
      observer?.disconnect();
      if (!element) return;
      const measure = () => {
        // Hidden retained session tabs report zero until activated again.
        if (element.clientWidth > 0) availableWidth.value = element.clientWidth;
      };
      measure();
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(measure);
        observer.observe(element);
      }
    },
    { flush: "post", immediate: true },
  );

  let stopDrag: (() => void) | undefined;
  function startDrag(event: MouseEvent) {
    if (event.button !== 0) return;
    stopDrag?.();
    isDragging.value = true;
    const startX = event.clientX;
    const startWidth = treeWidth.value;
    const move = (next: MouseEvent) => setWidth(startWidth + next.clientX - startX);
    const stop = () => {
      isDragging.value = false;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("blur", stop);
      stopDrag = undefined;
    };
    stopDrag = stop;
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    window.addEventListener("blur", stop);
  }

  function onResizeKeydown(event: KeyboardEvent) {
    const step = event.shiftKey ? 50 : 10;
    switch (event.key) {
      case "ArrowLeft":
        setWidth(treeWidth.value - step);
        break;
      case "ArrowRight":
        setWidth(treeWidth.value + step);
        break;
      case "Home":
        setWidth(MIN_TREE_WIDTH);
        break;
      case "End":
        setWidth(maxTreeWidth.value);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  onScopeDispose(() => {
    observer?.disconnect();
    stopDrag?.();
  });

  return {
    treeWidth,
    maxTreeWidth,
    minTreeWidth: MIN_TREE_WIDTH,
    isDragging,
    startDrag,
    onResizeKeydown,
    resetTreeWidth: () => setWidth(DEFAULT_TREE_WIDTH),
  };
}
