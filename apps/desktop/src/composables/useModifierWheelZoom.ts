import { onScopeDispose, ref } from "vue";
import { isMacPlatform } from "@/utils/platform";

const HINT_MS = 1400;

/**
 * Wheel zoom for a chart embedded in a scrolling page. A plain wheel scrolls
 * the page; Ctrl/⌘ + wheel zooms, as does a trackpad pinch, which Chromium
 * reports as a ctrl+wheel. A plain wheel briefly shows a hint instead.
 */
export function useModifierWheelZoom(zoom: (event: WheelEvent) => void) {
  const hintVisible = ref(false);
  const hintLabel = `${isMacPlatform() ? "⌘" : "Ctrl"} + scroll to zoom`;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  function onWheel(event: WheelEvent) {
    if (event.ctrlKey || event.metaKey) {
      // Also stops the webview's own page zoom on Ctrl + wheel.
      event.preventDefault();
      hintVisible.value = false;
      zoom(event);
      return;
    }
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    hintVisible.value = true;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hintVisible.value = false;
    }, HINT_MS);
  }

  onScopeDispose(() => clearTimeout(hintTimer));

  return { onWheel, hintVisible, hintLabel };
}
