<script setup lang="ts">
/**
 * The files modified in the most sessions, name first with the end of its
 * folder after; the full path is in each row's tooltip. Nothing records
 * lines per file, so sessions are the measure.
 */
import type { CodeImpactData } from "@tracepilot/types";
import { formatNumberFull, Tooltip } from "@tracepilot/ui";
import { computed, ref } from "vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import { splitFilePath } from "@/utils/codeImpact";

const props = defineProps<{
  files: CodeImpactData["mostModifiedFiles"];
  /** Unique paths in range, so the list can say how much it covers. */
  uniqueFiles: number;
}>();

const SHOWN = 10;
const showAll = ref(false);
const sessions = (n: number) => `${formatNumberFull(n)} session${n === 1 ? "" : "s"}`;

const rows = computed(() => {
  // `additions` holds the number of sessions that modified the file.
  const max = Math.max(1, ...props.files.map((file) => file.additions));
  return props.files.slice(0, showAll.value ? undefined : SHOWN).map((file) => ({
    path: file.path,
    ...splitFilePath(file.path),
    count: file.additions,
    width: Math.max(2, (file.additions / max) * 100),
  }));
});
</script>

<template>
  <OverviewPanel title="Most-modified files" data-testid="code-files">
    <template #aside><span>by sessions</span></template>

    <template v-if="rows.length">
      <div class="ad-rows" role="table" aria-label="Files modified in the most sessions">
        <div class="ad-rowh files__grid" role="row">
          <span role="columnheader">File</span>
          <span role="columnheader" />
          <span role="columnheader" class="ad-num">Sessions</span>
        </div>
        <Tooltip v-for="row in rows" :key="row.path" :text="`${row.path} · modified in ${sessions(row.count)}`">
          <div class="ad-row files__grid" role="row" data-testid="code-file-row">
            <span class="ad-row__name" role="cell">
              <span class="files__label">
                <span class="files__name">{{ row.name }}</span>
                <small v-if="row.folder">{{ row.folder }}</small>
              </span>
            </span>
            <span class="ad-track" role="cell" aria-hidden="true">
              <i :style="{ width: `${row.width}%`, background: 'var(--accent-fg)' }" data-reveal="grow-x" />
            </span>
            <span class="ad-num" role="cell">{{ formatNumberFull(row.count) }}</span>
          </div>
        </Tooltip>
      </div>
      <div class="ad-foot">
        <span>
          Top <b>{{ rows.length }}</b> of <b>{{ formatNumberFull(uniqueFiles) }}</b>
          file{{ uniqueFiles === 1 ? "" : "s" }}
        </span>
        <button v-if="files.length > SHOWN" type="button" class="ad-link" @click="showAll = !showAll">
          {{ showAll ? "Show fewer" : `Show ${files.length}` }}
        </button>
      </div>
    </template>
    <p v-else class="ad-empty">
      <b>No files modified</b>
      No session in this range recorded a file change.
    </p>
  </OverviewPanel>
</template>

<style scoped>
.files__grid {
  grid-template-columns: minmax(0, 2.2fr) minmax(40px, 0.8fr) 60px;
}

.files__label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.files__name {
  flex-shrink: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
}

.files__label small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font: 11px / 16px var(--font-mono);
  color: var(--text-tertiary);
}
</style>
