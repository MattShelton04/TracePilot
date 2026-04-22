import { useShortcut } from "@tracepilot/ui";
import { type ComputedRef, computed, type Ref, ref, watch } from "vue";
import type { SubagentFullData } from "./useCrossTurnSubagents";

/**
 * Manages the slide-out subagent detail panel state.
 *
 * Provides selection, prev/next navigation, and keyboard shortcuts
 * (Escape to close, arrow keys to navigate).
 */
export function useSubagentPanel(
  allSubagents: Ref<SubagentFullData[]> | ComputedRef<SubagentFullData[]>,
) {
  const selectedAgentId = ref<string | null>(null);
  const isPanelOpen = ref(false);

  const selectedIndex = computed(() => {
    if (!selectedAgentId.value) return -1;
    return allSubagents.value.findIndex((s) => s.agentId === selectedAgentId.value);
  });

  const selectedSubagent = computed<SubagentFullData | null>(() => {
    if (selectedIndex.value < 0) return null;
    return allSubagents.value[selectedIndex.value] ?? null;
  });

  const hasPrev = computed(() => selectedIndex.value > 0);
  const hasNext = computed(
    () => selectedIndex.value >= 0 && selectedIndex.value < allSubagents.value.length - 1,
  );

  function selectSubagent(agentId: string) {
    if (selectedAgentId.value === agentId && isPanelOpen.value) {
      closePanel();
      return;
    }
    selectedAgentId.value = agentId;
    isPanelOpen.value = true;
  }

  function closePanel() {
    selectedAgentId.value = null;
    isPanelOpen.value = false;
  }

  function navigatePrev() {
    if (hasPrev.value) {
      const prev = allSubagents.value[selectedIndex.value - 1];
      if (prev) selectSubagent(prev.agentId);
    }
  }

  function navigateNext() {
    if (hasNext.value) {
      const next = allSubagents.value[selectedIndex.value + 1];
      if (next) selectSubagent(next.agentId);
    }
  }

  const panelOpen = () => isPanelOpen.value;
  useShortcut("Escape", closePanel, { target: document, when: panelOpen });
  useShortcut("ArrowLeft", navigatePrev, { target: document, when: panelOpen });
  useShortcut("ArrowRight", navigateNext, { target: document, when: panelOpen });

  // Auto-close panel when selected subagent disappears (e.g. session switch)
  watch(selectedIndex, (idx) => {
    if (isPanelOpen.value && selectedAgentId.value && idx === -1) {
      closePanel();
    }
  });

  return {
    selectedAgentId,
    isPanelOpen,
    selectedIndex,
    selectedSubagent,
    hasPrev,
    hasNext,
    selectSubagent,
    closePanel,
    navigatePrev,
    navigateNext,
  };
}
