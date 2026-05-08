<script setup lang="ts">
/**
 * SearchResultExpandedDetails — shared expanded metadata grid for search hits.
 *
 * Renders the 6-field key/value grid (session, session id, turn, tool,
 * event index, timestamp) and an "Open in Session Viewer" link. Layout is
 * controlled via the `variant` prop:
 *   - "card"     → 1fr 1fr grid, used by SearchResultCard
 *   - "grouped"  → auto-fill min 200px grid, used by SearchGroupedResults
 *
 * The opening link is also styled differently per variant.
 */
import type { SearchResult } from "@tracepilot/types";
import { formatDateMedium } from "@tracepilot/ui";

defineProps<{
  result: SearchResult;
  sessionLink: string;
  variant?: "card" | "grouped";
}>();
</script>

<template>
  <div class="expanded-grid" :class="`expanded-grid--${variant ?? 'card'}`">
    <div v-if="result.sessionSummary" class="expanded-item">
      <span class="expanded-label">Session</span>
      <span class="expanded-value">{{ result.sessionSummary }}</span>
    </div>
    <div class="expanded-item">
      <span class="expanded-label">Session ID</span>
      <span class="expanded-value expanded-mono">{{ result.sessionId }}</span>
    </div>
    <div v-if="result.turnNumber != null" class="expanded-item">
      <span class="expanded-label">Turn</span>
      <span class="expanded-value">{{ result.turnNumber }}</span>
    </div>
    <div v-if="result.toolName" class="expanded-item">
      <span class="expanded-label">Tool</span>
      <span class="expanded-value expanded-mono">{{ result.toolName }}</span>
    </div>
    <div v-if="result.eventIndex != null" class="expanded-item">
      <span class="expanded-label">Event Index</span>
      <span class="expanded-value">{{ result.eventIndex }}</span>
    </div>
    <div v-if="result.timestampUnix != null" class="expanded-item">
      <span class="expanded-label">Timestamp</span>
      <span class="expanded-value">{{ formatDateMedium(result.timestampUnix) }}</span>
    </div>
  </div>
  <router-link
    :to="sessionLink"
    class="expanded-view-btn"
    :class="`expanded-view-btn--${variant ?? 'card'}`"
    @click.stop
  >
    Open in Session Viewer →
  </router-link>
</template>

<style scoped>
.expanded-grid {
  display: grid;
  margin-bottom: 12px;
}
.expanded-grid--card {
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
}
.expanded-grid--grouped {
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.expanded-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.expanded-label {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.expanded-grid--grouped .expanded-label {
  font-weight: normal;
  letter-spacing: 0.05em;
}
.expanded-value {
  font-size: 0.75rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.expanded-grid--grouped .expanded-value {
  color: var(--text-primary);
  font-weight: 500;
}
.expanded-mono {
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
  font-size: 0.6875rem;
}
.expanded-grid--grouped .expanded-mono {
  font-family: "JetBrains Mono", monospace;
}
.expanded-view-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  text-decoration: none;
  font-family: inherit;
  transition: all var(--transition-fast);
}
.expanded-view-btn--card {
  padding: 6px 14px;
  border-radius: var(--radius-md);
  background: var(--accent-subtle);
  border: 1px solid var(--border-accent);
  color: var(--accent-fg);
  font-size: 0.75rem;
  font-weight: 500;
}
.expanded-view-btn--card:hover {
  background: var(--accent-muted);
}
.expanded-view-btn--grouped {
  gap: 6px;
  padding: 6px 12px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--accent-fg);
  background: var(--accent-subtle);
  border: 1px solid var(--accent-fg);
  border-radius: var(--radius-sm);
}
.expanded-view-btn--grouped:hover {
  background: var(--accent-emphasis);
  color: white;
}
</style>
