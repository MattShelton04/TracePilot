import { onMounted, onUnmounted, ref, type Ref } from "vue";

/**
 * Tracks the correct top offset for the fixed-position subagent panel so it
 * sits just below the sticky `.detail-actions` action bar, and computes
 * breakout margins so the chat column can extend past `.page-content-inner`
 * when the panel is open (without nudging sibling layout elements).
 *
 * Returns `panelTopPx` for binding on the panel, and wires window + page
 * scroll listeners to `cvRootEl` for lifecycle-managed updates.
 */
export function useChatViewPanelOffset(cvRootEl: Ref<HTMLElement | null>) {
  const panelTopPx = ref(0);
  let pageScrollEl: HTMLElement | null = null;

  function updatePanelTop() {
    const cvRoot = cvRootEl.value;
    if (!cvRoot) return;
    const cvRect = cvRoot.getBoundingClientRect();

    // Find the sticky action bar (.detail-actions) — it sticks at top of scroll area
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
      cvRoot.style.setProperty("--breakout-left", `${sideGap}px`);
      // Extend right through page-content padding so content meets the panel edge
      cvRoot.style.setProperty("--breakout-right", `${sideGap + padR}px`);
    }
  }

  onMounted(() => {
    updatePanelTop();
    window.addEventListener("resize", updatePanelTop);
    // Listen to scroll on the page-content container (the page scroller)
    pageScrollEl = cvRootEl.value?.closest(".page-content") as HTMLElement | null;
    if (pageScrollEl) {
      pageScrollEl.addEventListener("scroll", updatePanelTop, { passive: true });
    }
  });

  onUnmounted(() => {
    window.removeEventListener("resize", updatePanelTop);
    if (pageScrollEl) {
      pageScrollEl.removeEventListener("scroll", updatePanelTop);
    }
  });

  return { panelTopPx, updatePanelTop };
}
