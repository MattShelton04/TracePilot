import { onMounted, onUnmounted, type Ref, ref } from "vue";

/**
 * Tracks the correct top offset for the fixed-position subagent panel so it
 * sits just below the sticky `.detail-actions` action bar, and computes
 * breakout margins so the chat column can extend past `.page-content-inner`
 * when the panel is open (without nudging sibling layout elements).
 *
 * Returns `panelTopPx` for binding on the panel, and wires window + page
 * scroll listeners to `cvRootEl` for lifecycle-managed updates.
 *
 * Performance notes:
 *  - The scroll handler only does two `getBoundingClientRect()` reads and a
 *    single ref write; cached element lookups avoid repeated `querySelector`
 *    + `closest` walks.
 *  - The breakout-margin calculation (which calls `getComputedStyle` and
 *    sets CSS custom properties) only runs on mount and on resize, since
 *    those values do not change during scroll.
 *  - The scroll handler is rAF-throttled so multiple scroll events within a
 *    frame coalesce into one DOM update.
 */
export function useChatViewPanelOffset(cvRootEl: Ref<HTMLElement | null>) {
  const panelTopPx = ref(0);

  // Cached DOM references — resolved on mount (or lazily on first scroll if
  // not yet present, e.g. if .detail-actions mounts after this composable).
  let actionsEl: HTMLElement | null = null;
  let pageScrollEl: HTMLElement | null = null;
  let pageContent: HTMLElement | null = null;
  let pageContentInner: HTMLElement | null = null;

  let rafHandle = 0;
  let scrollPending = false;

  function resolveCachedEls() {
    const cvRoot = cvRootEl.value;
    if (!cvRoot) return;
    if (!actionsEl) actionsEl = document.querySelector(".detail-actions") as HTMLElement | null;
    if (!pageContent) pageContent = cvRoot.closest(".page-content") as HTMLElement | null;
    if (!pageContentInner) {
      pageContentInner = cvRoot.closest(".page-content-inner") as HTMLElement | null;
    }
    if (!pageScrollEl) pageScrollEl = pageContent;
  }

  function updatePanelTop() {
    const cvRoot = cvRootEl.value;
    if (!cvRoot) return;

    if (!actionsEl) {
      actionsEl = document.querySelector(".detail-actions") as HTMLElement | null;
    }

    const cvRect = cvRoot.getBoundingClientRect();
    const actionsBottom = actionsEl ? actionsEl.getBoundingClientRect().bottom : 0;
    const next = Math.max(cvRect.top, actionsBottom);

    if (next !== panelTopPx.value) {
      panelTopPx.value = next;
    }
  }

  function updateBreakoutMargins() {
    const cvRoot = cvRootEl.value;
    if (!cvRoot || !pageContent || !pageContentInner) return;

    const pcStyle = getComputedStyle(pageContent);
    const padL = parseFloat(pcStyle.paddingLeft) || 0;
    const padR = parseFloat(pcStyle.paddingRight) || 0;
    const pcContentWidth = pageContent.clientWidth - padL - padR;
    const pciWidth = pageContentInner.offsetWidth;
    const sideGap = Math.max(0, (pcContentWidth - pciWidth) / 2);
    cvRoot.style.setProperty("--breakout-left", `${sideGap}px`);
    cvRoot.style.setProperty("--breakout-right", `${sideGap + padR}px`);
  }

  function onScroll() {
    if (scrollPending) return;
    scrollPending = true;
    rafHandle = requestAnimationFrame(() => {
      scrollPending = false;
      updatePanelTop();
    });
  }

  function onResize() {
    resolveCachedEls();
    updatePanelTop();
    updateBreakoutMargins();
  }

  onMounted(() => {
    resolveCachedEls();
    updatePanelTop();
    updateBreakoutMargins();
    window.addEventListener("resize", onResize);
    if (pageScrollEl) {
      pageScrollEl.addEventListener("scroll", onScroll, { passive: true });
    }
  });

  onUnmounted(() => {
    if (rafHandle) cancelAnimationFrame(rafHandle);
    window.removeEventListener("resize", onResize);
    if (pageScrollEl) {
      pageScrollEl.removeEventListener("scroll", onScroll);
    }
  });

  return { panelTopPx, updatePanelTop };
}
