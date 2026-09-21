<script setup lang="ts">
/**
 * Related work — pull requests, issues and Git refs mentioned in a session.
 *
 * Every value here is untrusted source text. It is rendered through normal
 * interpolation (never `v-html`) and only ever opened through `openExternal`,
 * which re-validates the URL before handing it to the system browser.
 */
import type { StoreAvailability } from "@tracepilot/types";
import { ErrorAlert, SectionPanel, SkeletonLoader, StatusPill, Tooltip } from "@tracepilot/ui";
import { computed, ref, watch } from "vue";
import { useSessionWorkRefs } from "@/composables/useSessionWorkRefs";
import { openExternal } from "@/utils/openExternal";

const props = defineProps<{ sessionId: string | null | undefined }>();

const { enabled, loading, loaded, error, rows, sourceAvailable, sourceAvailability, retry } =
  useSessionWorkRefs(() => props.sessionId);

const expanded = ref(false);
const visibleRows = computed(() => (expanded.value ? rows.value : rows.value.slice(0, 8)));
watch(
  () => props.sessionId,
  () => {
    expanded.value = false;
  },
);

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
  <SectionPanel v-if="enabled" title="Related work" class="mb-6">
    <!-- Stated once for the whole list, not repeated per row. -->
    <p class="related-work-note">
      References found in this session. Finding a reference is not proof that the session
      opened, reviewed, merged or completed that work.
    </p>

    <p v-if="sourceAvailable && sourceAvailability && sourceAvailability !== 'ready'" class="related-work-message">
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
    <SkeletonLoader v-else-if="loading && !loaded" :count="2" />
    <p v-else-if="!sourceAvailable" class="related-work-message related-work-unavailable">
      The reference source is unavailable, so no references could be read for this session.
      That is not the same as this session having no linked work.
      <span v-if="availabilityDetail"> {{ availabilityDetail }}</span>
    </p>
    <p v-else-if="rows.length === 0" class="related-work-message">
      The reference source was read and recorded no references for this session.
    </p>
    <ul v-else class="related-work-list">
      <li
        v-for="row in visibleRows"
        :key="row.identity"
        class="related-work-row"
        :data-resolution="row.resolution"
      >
        <span class="ref-kind">{{ row.kindLabel }}</span>

        <span class="ref-value" :title="row.rawValue">
          <a
            v-if="row.presentation === 'link' && row.href"
            class="ref-link"
            href="#"
            @click.prevent="openRef(row.href)"
          >{{ row.displayValue }}</a>
          <span v-else class="ref-plain">{{ row.displayValue }}</span>
        </span>

        <span v-if="row.shaCandidate" class="ref-note">
          Candidate commit — the text looks like a SHA; no commit was verified
        </span>

        <span v-if="row.repository" class="ref-repo">
          <template v-if="row.repositoryVerified">{{ row.repository }}</template>
          <Tooltip
            v-else
            text="Repository context guessed from this session's own repository. A reference to another repository would make it wrong, so it is not a link."
          >
            <span class="ref-repo-unverified">{{ row.repository }} (unverified)</span>
          </Tooltip>
        </span>
        <span v-if="row.host" class="ref-host">{{ row.host }}</span>

        <Tooltip :text="row.resolutionHint" position="left">
          <StatusPill :tone="row.resolutionTone" :label="row.resolutionLabel" size="xs" />
        </Tooltip>
      </li>
    </ul>
    <button v-if="rows.length > 8" type="button" class="btn btn-secondary btn-sm mt-3" :aria-expanded="expanded" @click="expanded = !expanded">
      {{ expanded ? "Show fewer references" : `Show all ${rows.length} references` }}
    </button>
  </SectionPanel>
</template>

<style scoped>
.related-work-note {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  line-height: 1.5;
  margin: 0 0 12px 0;
}

.related-work-message {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
}

.related-work-unavailable {
  color: var(--warning-fg);
}

.related-work-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.related-work-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.related-work-row:last-child {
  border-bottom: none;
}

.ref-kind {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
  min-width: 88px;
}

.ref-value {
  font-size: 0.8125rem;
  font-weight: 500;
  min-width: 0;
  overflow-wrap: anywhere;
}

.ref-link {
  color: var(--accent-fg);
  text-decoration: underline;
}

.ref-plain {
  color: var(--text-primary);
}

.ref-note {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.ref-repo,
.ref-host {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.ref-repo-unverified {
  border-bottom: 1px dashed var(--border);
  color: var(--text-tertiary);
  cursor: help;
}

/* Pushes the resolution pill to the end of the row. */
.related-work-row > :last-child {
  margin-left: auto;
}
</style>
