<script setup lang="ts">
import { useAgentTreeContext } from "@/composables/useAgentTree";

const ctx = useAgentTreeContext();
</script>

<template>
  <div class="view-header">
    <div class="view-header-spacer"></div>

    <div class="turn-nav">
      <button
        class="turn-nav-btn"
        :disabled="!ctx.canPrevAgent.value || ctx.viewMode.value === 'unified'"
        @click="ctx.jumpToEarliestAgent()"
        aria-label="Jump to earliest agent turn"
      >
        ⏮ Earliest
      </button>
      <button
        class="turn-nav-btn"
        :disabled="ctx.agentTurnIndex.value === 0 || ctx.viewMode.value === 'unified'"
        @click="ctx.prevAgentTurn()"
        aria-label="Previous agent turn"
      >
        ◀ Prev
      </button>
      <span class="turn-nav-label">{{ ctx.viewMode.value === 'unified' ? 'Unified Session View' : ctx.turnNavLabel.value }}</span>
      <button
        class="turn-nav-btn"
        :disabled="ctx.agentTurnIndex.value === ctx.agentTurns.value.length - 1 || ctx.viewMode.value === 'unified'"
        @click="ctx.nextAgentTurn()"
        aria-label="Next agent turn"
      >
        Next ▶
      </button>
      <button
        class="turn-nav-btn"
        :disabled="!ctx.canNextAgent.value || ctx.viewMode.value === 'unified'"
        @click="ctx.jumpToLatestAgent()"
        aria-label="Jump to latest agent turn"
      >
        Latest ⏭
      </button>
    </div>

    <div class="view-mode-toggle">
      <button
        class="view-mode-btn"
        :class="{ 'view-mode-btn--active': ctx.viewMode.value === 'paginated' }"
        @click="ctx.setViewMode('paginated')"
      >
        Paginated
      </button>
      <button
        class="view-mode-btn"
        :class="{ 'view-mode-btn--active': ctx.viewMode.value === 'unified' }"
        @click="ctx.setViewMode('unified')"
      >
        Unified
      </button>
    </div>
  </div>
</template>
