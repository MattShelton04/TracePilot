<script setup lang="ts">
/**
 * Related work — pull requests, issues and Git refs mentioned in a session.
 *
 * Every value here is untrusted source text. It is rendered through normal
 * interpolation (never `v-html`) and only ever opened through `openExternal`,
 * which re-validates the URL before handing it to the system browser.
 *
 * References are grouped by kind as compact chips. What most of them share —
 * a repository assumed from the session rather than named by the reference —
 * is said once for the panel instead of as a warning on every row; each chip
 * keeps its raw value and resolution in its tooltip.
 */
import type { StoreAvailability } from "@tracepilot/types";
import { ErrorAlert, SectionPanel } from "@tracepilot/ui";
import { ExternalLink } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useSessionWorkRefs } from "@/composables/useSessionWorkRefs";
import { openExternal } from "@/utils/openExternal";
import {
  groupWorkRefRows,
  sharedContextRepository,
  type WorkRefGroup,
  type WorkRefRow,
  workRefTooltip,
} from "@/utils/workRefs";

/** Chips shown per group before it asks to be expanded: about two rows. */
const COLLAPSED_PER_GROUP = 40;

const props = defineProps<{ sessionId: string | null | undefined }>();

const { enabled, error, rows, sourceAvailability, retry } = useSessionWorkRefs(
  () => props.sessionId,
);

/** Kinds whose full list the reader asked for. */
const expanded = ref(new Set<string>());
watch(
  () => props.sessionId,
  () => {
    expanded.value = new Set();
  },
);

const groups = computed(() => groupWorkRefRows(rows.value));
function visible(group: WorkRefGroup): WorkRefRow[] {
  return expanded.value.has(group.kind) ? group.rows : group.rows.slice(0, COLLAPSED_PER_GROUP);
}
function hiddenCount(group: WorkRefGroup): number {
  return group.rows.length - visible(group).length;
}
function toggle(group: WorkRefGroup) {
  const next = new Set(expanded.value);
  if (!next.delete(group.kind)) next.add(group.kind);
  expanded.value = next;
}

const contextRepository = computed(() => sharedContextRepository(rows.value));

/** The repository a chip must name: its own, or context the panel did not state. */
function chipRepository(row: WorkRefRow): string | null {
  if (!row.repository) return null;
  if (!row.repositoryVerified && row.repository === contextRepository.value) return null;
  return row.repository;
}

// An absent store is the expected state on a Copilot CLI that predates it, so
// each state gets its own sentence rather than a generic failure.
const AVAILABILITY_DETAIL: Record<StoreAvailability, string> = {
  disabled: "Session-store enrichment is switched off in Settings.",
  missing: "No Copilot session store was found. Installations before it simply do not have one.",
  ready: "",
  busy: "The store was in use by another process when it was last read.",
  unreadable: "The store could not be read. Any earlier reference data is shown as-is.",
  incompatible: "The store's schema is not one this version can read.",
};

const availabilityDetail = computed(() =>
  sourceAvailability.value ? AVAILABILITY_DETAIL[sourceAvailability.value] : "",
);

function openRef(href: string | null) {
  if (href) void openExternal(href);
}
</script>

<template>
  <!--
    Shown only with something to show. Most sessions mention no PR, issue or
    ref, and a machine without a store has none to read: a panel saying so on
    every overview is noise. Neither absence claims the work does not exist,
    and Settings reports the source's availability.
  -->
  <SectionPanel v-if="enabled && (rows.length > 0 || error)" title="Related work" class="mb-6">
    <!-- Stated once for the whole list, not repeated per row. -->
    <p class="related-work-note">
      References found in this session. Finding a reference is not proof that the session
      opened, reviewed, merged or completed that work.
    </p>

    <p v-if="sourceAvailability && sourceAvailability !== 'ready'" class="related-work-message">
      Showing cached references. {{ availabilityDetail }}
    </p>

    <ErrorAlert
      v-if="error"
      :message="`Related work: ${error}`"
      severity="warning"
      variant="inline"
      :retryable="true"
      @retry="retry"
    />
    <template v-else>
      <p v-if="contextRepository" class="related-work-context">
        References without a repository of their own are placed in this session's repository,
        <span
          class="ref-repo-unverified"
          title="Taken from this session, not from the references. A reference to another repository would make it wrong, so these are not links."
        >{{ contextRepository }} (unverified)</span>.
      </p>

      <div class="related-work-list">
        <section
          v-for="group in groups"
          :key="group.kind"
          class="related-work-group"
          :data-kind="group.kind"
        >
          <h4 class="ref-kind">
            {{ group.label }} <span class="ref-count">{{ group.rows.length }}</span>
          </h4>
          <ul class="ref-chips">
            <li
              v-for="row in visible(group)"
              :key="row.identity"
              class="related-work-row"
              :class="{ 'related-work-row--sha': row.shaCandidate }"
              :data-resolution="row.resolution"
              :title="workRefTooltip(row)"
            >
              <span v-if="chipRepository(row)" class="ref-repo">{{ chipRepository(row) }}</span>
              <a
                v-if="row.presentation === 'link' && row.href"
                class="ref-link"
                href="#"
                @click.prevent="openRef(row.href)"
              >{{ row.displayValue }}<ExternalLink :size="11" aria-hidden="true" /></a>
              <span v-else class="ref-plain">{{ row.displayValue }}</span>
            </li>
            <li v-if="group.rows.length > COLLAPSED_PER_GROUP">
              <button
                type="button"
                class="ref-more"
                :aria-expanded="expanded.has(group.kind)"
                @click="toggle(group)"
              >
                {{ hiddenCount(group) > 0 ? `+${hiddenCount(group)} more` : "Show fewer" }}
              </button>
            </li>
          </ul>
          <p v-if="group.hasShaCandidate" class="ref-note">
            Candidate commits — these values look like SHAs; no commit was verified.
          </p>
        </section>
      </div>
    </template>
  </SectionPanel>
</template>

<style scoped>
.related-work-note {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  line-height: 1.5;
  margin: 0 0 12px 0;
}

.related-work-message,
.related-work-context {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
}

.related-work-context {
  margin-bottom: 14px;
}

.related-work-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ref-kind {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0 0 6px;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
}

.ref-count {
  font-variant-numeric: tabular-nums;
  font-weight: 400;
}

.ref-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.related-work-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 1px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-subtle);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.6;
  cursor: default;
}

.related-work-row--sha {
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

/* No repository at all: a searchable label, visibly quieter than the rest. */
.related-work-row[data-resolution="unresolved"] {
  border-style: dashed;
  background: transparent;
}

.related-work-row[data-resolution="explicit"] {
  border-color: var(--accent-muted);
  background: var(--accent-subtle);
}

.ref-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--accent-fg);
  text-decoration: none;
}

.ref-link:hover,
.ref-link:focus-visible {
  text-decoration: underline;
}

.ref-plain {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-primary);
}

.ref-repo {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.ref-more {
  padding: 1px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--accent-fg);
  font-size: 0.8125rem;
  line-height: 1.6;
  cursor: pointer;
}

.ref-more:hover,
.ref-more:focus-visible {
  border-color: var(--border-default);
}

.ref-note {
  margin: 6px 0 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.ref-repo-unverified {
  border-bottom: 1px dashed var(--border-default);
  color: var(--text-primary);
  cursor: help;
}
</style>
