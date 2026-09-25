import { onMounted, onUnmounted, type Ref, ref, watch } from "vue";

/**
 * Tracks the correct top offset for the fixed-position subagent panel so it
 * sits just below the sticky `.detail-actions` action bar, and computes
 * breakout margins so the chat column can extend past `.page-content-inner`
 * when the panel is open (without nudging sibling layout elements).
 *
 * Returns `panelTopPx` for binding on the panel, and wires window + page
 * scroll listeners to `cvRootEl` for lifecycle-managed updates.
 */
export function useChatViewPanelOffset(
  cvRootEl: Ref<HTMLElement | null>,
  /** Skip scroll-driven updates while the panel is hidden (the common case). */
  isActive: () => boolean = () => true,
) {
  const panelTopPx = ref(0);
  let pageScrollEl: HTMLElement | null = null;
  let lastBreakoutLeft = "";
  let lastBreakoutRight = "";

  function onScroll() {
    if (isActive()) updatePanelTop();
  }

  function updatePanelTop() {
    const cvRoot = cvRootEl.value;
    if (!cvRoot) return;
    const cvRect = cvRoot.getBoundingClientRect();

    // Find the sticky action bar (.detail-actions) ÔÇö it sticks at top of scroll area
    const actionsEl = document.querySelector(".detail-actions") as HTMLElement | null;
    const actionsBottom = actionsEl ? actionsEl.getBoundingClientRect().bottom : 0;

    // Panel top = whichever is lower: cv-root top or sticky bar bottom
    panelTopPx.value = Math.max(cvRect.top, actionsBottom);

    // Compute breakout offsets so .cv-root can extend beyond .page-content-inner
    // when the panel is open, without affecting sibling elements (toolbar, badges, etc.)
    const pc = cvRoot.closest(".page-content") as HTMLElement | null;
    const pci = cvRoot.closest(".page-content-inner") as HTMLElement | null;
    if (pc && pci) {
      const pcStyle = getComputedStyle(pc);
      const padL = parseFloat(pcStyle.paddingLeft) || 0;
      const padR = parseFloat(pcStyle.paddingRight) || 0;
      const pcContentWidth = pc.clientWidth - padL - padR;
      const pciWidth = pci.offsetWidth;
      const sideGap = Math.max(0, (pcContentWidth - pciWidth) / 2);
      // Extend right through page-content padding so content meets the panel edge
      const left = `${sideGap}px`;
      const right = `${sideGap + padR}px`;
      // This runs on every scroll event but the offsets only change on resize.
      // Writing a custom property invalidates style for the whole conversation
      // subtree, so skip redundant writes.
      if (left !== lastBreakoutLeft) {
        cvRoot.style.setProperty("--breakout-left", left);
        lastBreakoutLeft = left;
      }
      if (right !== lastBreakoutRight) {
        cvRoot.style.setProperty("--breakout-right", right);
        lastBreakoutRight = right;
      }
    }
  }

  onMounted(() => {
    updatePanelTop();
    window.addEventListener("resize", updatePanelTop);
    // Listen to scroll on the page-content container (the page scroller)
    pageScrollEl = cvRootEl.value?.closest(".page-content") as HTMLElement | null;
    if (pageScrollEl) {
      pageScrollEl.addEventListener("scroll", onScroll, { passive: true });
    }
  });

  // Position the panel as soon as it opens, since scroll updates were skipped.
  watch(isActive, (active) => {
    if (active) updatePanelTop();
  });

  onUnmounted(() => {
    window.removeEventListener("resize", updatePanelTop);
    if (pageScrollEl) {
      pageScrollEl.removeEventListener("scroll", onScroll);
    }
  });

  return { panelTopPx, updatePanelTop };
}
