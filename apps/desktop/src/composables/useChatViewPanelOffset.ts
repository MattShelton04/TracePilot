import { onMounted, onUnmounted, type Ref, ref } from "vue";

/**
 * Tracks the correct top offset for the fixed-position subagent panel so it
 * sits just below the sticky `.detail-actions` action bar, and computes
 * breakout margins so the chat column can extend past `.page-content-inner`
 * when the panel is open (without nudging sibling layout elements).
 *
 * Returns `panelTopPx` for binding on the panel.
 *
 * Performance notes:
 *  - The panel is `position: fixed` and its `top` controls its height
 *    (`height = viewport - top` because `bottom: 0`). Updating `top` on every
 *    scroll forces a layout/paint of the panel's (often very large) descendant
 *    tree every frame. With huge sessions (200k+ DOM nodes nearby) this drove
 *    300ms long tasks per scroll near the top of the page.
 *  - We now debounce the update so `panelTopPx` only changes when the user
 *    *stops* scrolling (~80ms idle). During active scroll the panel keeps its
 *    last known position — visually a tiny lag relative to the action bar at
 *    the very top of the page, but no per-frame thrash.
 *  - Breakout-margin work (`getComputedStyle` + CSS-var writes) only runs on
 *    mount and on resize.
 */
export function useChatViewPanelOffset(cvRootEl: Ref<HTMLElement | null>) {
  const panelTopPx = ref(0);

  let actionsEl: HTMLElement | null = null;
  let pageScrollEl: HTMLElement | null = null;
  let pageContent: HTMLElement | null = null;
  let pageContentInner: HTMLElement | null = null;

  let scrollDebounceHandle: ReturnType<typeof setTimeout> | null = null;
  const SCROLL_IDLE_MS = 80;

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
    const next = Math.round(Math.max(cvRect.top, actionsBottom));

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
    if (scrollDebounceHandle !== null) clearTimeout(scrollDebounceHandle);
    scrollDebounceHandle = setTimeout(() => {
      scrollDebounceHandle = null;
      updatePanelTop();
    }, SCROLL_IDLE_MS);
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
    if (scrollDebounceHandle !== null) clearTimeout(scrollDebounceHandle);
    window.removeEventListener("resize", onResize);
    if (pageScrollEl) {
      pageScrollEl.removeEventListener("scroll", onScroll);
    }
  });

  return { panelTopPx, updatePanelTop };
}
