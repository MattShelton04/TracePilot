<script setup lang="ts">
/**
 * Which kinds of file changed: every type's share of modifications as one
 * split bar, then the leading types ranked. A file counts once for each
 * session that modified it.
 */
import type { CodeImpactData } from "@tracepilot/types";
import { formatNumberFull, Tooltip } from "@tracepilot/ui";
import { computed } from "vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import { useAnalyticsStore } from "@/stores/analytics";
import { analyticsEmptyScope, formatShare } from "@/utils/analyticsDashboard";
import { fileTypeRows, fileTypeSplit } from "@/utils/codeImpact";

const props = defineProps<{ breakdown: CodeImpactData["fileTypeBreakdown"] }>();

const filters = useAnalyticsStore();
/** Names the filters that emptied the panel. */
const scope = computed(() => analyticsEmptyScope(filters));

const SHOWN = 8;
const rows = computed(() => fileTypeRows(props.breakdown));
const split = computed(() => fileTypeSplit(rows.value));
const top = computed(() => rows.value.slice(0, SHOWN));
const rest = computed(() => rows.value.slice(SHOWN));
const total = computed(() => rows.value.reduce((sum, row) => sum + row.count, 0));
const maxCount = computed(() => Math.max(1, rows.value[0]?.count ?? 1));
const edits = (n: number) => `${formatNumberFull(n)} modification${n === 1 ? "" : "s"}`;
</script>

<template>
  <OverviewPanel title="File types" data-testid="code-file-types">
    <template #aside>
      <span v-if="total">{{ edits(total) }}</span>
    </template>

    <template v-if="rows.length">
      <div class="ad-meter ad-meter--lg file-types__split">
        <span
          v-for="part in split"
          :key="part.key"
          class="file-types__segment"
          :style="{ width: `${part.share}%` }"
        >
          <Tooltip :text="`${part.label}: ${edits(part.count)} · ${formatShare(part.share)}`">
            <i :style="{ background: part.color }" data-reveal="grow-x" />
          </Tooltip>
        </span>
      </div>
      <div class="ad-rows" role="table" aria-label="File types by modifications">
        <div class="ad-rowh file-types__grid" role="row">
          <span role="columnheader">Type</span>
          <span role="columnheader" />
          <span role="columnheader" class="ad-num">Edits</span>
          <span role="columnheader" class="ad-num">Share</span>
        </div>
        <Tooltip
          v-for="row in top"
          :key="row.key"
          :text="`${row.label}: ${edits(row.count)}, ${formatShare(row.share)} of all`"
        >
          <div class="ad-row file-types__grid" role="row">
            <span class="ad-row__name" role="cell">
              <i class="ad-sw" :style="{ background: row.color }" />
              <span class="file-types__ext">{{ row.label }}</span>
            </span>
            <span class="ad-track" role="cell" aria-hidden="true">
              <i
                :style="{ width: `${Math.max(1, (row.count / maxCount) * 100)}%`, background: row.color }"
                data-reveal="grow-x"
              />
            </span>
            <span class="ad-num" role="cell">{{ formatNumberFull(row.count) }}</span>
            <span class="ad-num ad-num--muted" role="cell">{{ formatShare(row.share) }}</span>
          </div>
        </Tooltip>
      </div>
      <p class="ad-note file-types__note">
        <template v-if="rest.length">
          <b>{{ rest.length }}</b> more type{{ rest.length === 1 ? "" : "s" }}
          ({{ formatShare(rest.reduce((sum, row) => sum + row.share, 0)) }}) ·
        </template>
        a file counts once for each session that modified it
      </p>
    </template>
    <p v-else class="ad-empty">
      <b>No files modified</b>
      No {{ scope.source }}session{{ scope.suffix }} recorded a file change.
    </p>
  </OverviewPanel>
</template>

<style scoped>
.file-types__split {
  margin-bottom: 10px;
}

.file-types__segment {
  display: flex;
  min-width: 3px;
}

.file-types__segment > :deep(.tooltip) {
  display: flex;
  flex: 1;
}

.file-types__segment i {
  display: block;
  flex: 1;
  height: 100%;
  border-radius: 2px;
}

.file-types__grid {
  grid-template-columns: minmax(0, 0.9fr) minmax(48px, 1.4fr) 56px 44px;
}

.file-types__ext {
  font-family: var(--font-mono);
}

.file-types__note {
  margin-top: auto;
  padding-top: 10px;
}
</style>
