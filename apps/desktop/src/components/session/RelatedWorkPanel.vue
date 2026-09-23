<script setup lang="ts">
/**
 * Related work — pull requests, issues, commits and branches mentioned in a
 * session, as recorded by the Copilot CLI.
 *
 * Every value here is untrusted source text. It is rendered through normal
 * interpolation (never `v-html`) and only ever opened through `openExternal`,
 * which re-validates the URL before handing it to the system browser.
 *
 * References are compact chips grouped by kind. A chip with a link opens it;
 * every chip has a menu (right-click, or a click when there is no link) to
 * copy it or find the other sessions that mention it. Bare numbers link into
 * the session's own repository, which the panel says once rather than on
 * every chip.
 */
import type { StoreAvailability } from "@tracepilot/types";
import { ErrorAlert, SectionPanel, useClipboard, useToast } from "@tracepilot/ui";
import { ExternalLink } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import WorkRefMenu from "@/components/session/WorkRefMenu.vue";
import { useSessionWorkRefs } from "@/composables/useSessionWorkRefs";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
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

const props = defineProps<{
  sessionId: string | null | undefined;
  /** TracePilot's host type for the session; `github` allows bare numbers to link. */
  hostType?: string | null;
}>();

const { enabled, error, rows, sourceAvailability, retry } = useSessionWorkRefs(
  () => props.sessionId,
  () => ({ sessionHost: props.hostType === "github" ? "github.com" : null }),
);

/** Kinds whose full list the reader asked for. */
const expanded = ref(new Set<string>());
watch(
  () => props.sessionId,
  () => {
    expanded.value = new Set();
    menu.value = null;
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
const linksInferred = computed(() => rows.value.some((row) => row.linkInferred));

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

// ── Actions ────────────────────────────────────────────────────────
const router = useRouter();
const toast = useToast();
const { copy } = useClipboard();
const menu = ref<{ row: WorkRefRow; position: { x: number; y: number } } | null>(null);

function openMenu(row: WorkRefRow, event: MouseEvent) {
  // A keyboard-invoked context menu reports no pointer position; anchor it
  // under the chip instead.
  const target = event.currentTarget as HTMLElement | null;
  const rect = target?.getBoundingClientRect();
  const fromPointer = event.clientX !== 0 || event.clientY !== 0;
  menu.value = {
    row,
    position:
      fromPointer || !rect
        ? { x: event.clientX, y: event.clientY }
        : { x: rect.left, y: rect.bottom + 4 },
  };
}

function activate(row: WorkRefRow, event: MouseEvent) {
  if (row.href) void openExternal(row.href);
  else openMenu(row, event);
}

async function copyText(text: string, label: string) {
  if (await copy(text)) toast.success(`Copied ${label}`);
  else toast.error("Could not copy to the clipboard");
}

function runAction(action: "open" | "copyLink" | "copyReference" | "search") {
  const row = menu.value?.row;
  menu.value = null;
  if (!row) return;
  if (action === "open" && row.href) void openExternal(row.href);
  if (action === "copyLink" && row.href) void copyText(row.href, "link");
  if (action === "copyReference") void copyText(row.copyText, row.copyText);
  if (action === "search" && row.searchQuery) {
    void pushRoute(router, ROUTE_NAMES.search, { query: { q: row.searchQuery } });
  }
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
    <p class="related-work-note">
      Mentioned in this session, which is not proof the session worked on them. Right-click a
      reference to copy it or find other sessions that mention it.
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
        Numbers without a repository of their own are taken to be in this session's repository,
        <span
          class="ref-repo-inferred"
          title="Taken from this session, not from the references. A mention of another repository would open the wrong page."
        >{{ contextRepository }}</span><template v-if="!linksInferred">; the session's host is not known, so they are not linked</template>.
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
            >
              <button
                type="button"
                class="ref-chip"
                :class="{ 'ref-chip--link': row.href }"
                :title="workRefTooltip(row)"
                @click="activate(row, $event)"
                @contextmenu.prevent="openMenu(row, $event)"
              >
                <span v-if="chipRepository(row)" class="ref-repo">{{ chipRepository(row) }}</span>
                <span class="ref-value">{{ row.displayValue }}</span>
                <ExternalLink v-if="row.href" :size="11" aria-hidden="true" />
              </button>
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
        </section>
      </div>
    </template>

    <WorkRefMenu
      :row="menu?.row ?? null"
      :position="menu?.position ?? { x: 0, y: 0 }"
      @open="runAction('open')"
      @copy-link="runAction('copyLink')"
      @copy-reference="runAction('copyReference')"
      @search="runAction('search')"
      @dismiss="menu = null"
    />
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
  max-width: 100%;
}

.ref-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 1px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-subtle);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.6;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition-fast);
}

.ref-chip:hover,
.ref-chip:focus-visible {
  border-color: var(--border-emphasis);
}

.ref-chip:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 1px;
}

.ref-chip--link {
  color: var(--accent-fg);
}

.ref-chip--link:hover .ref-value,
.ref-chip--link:focus-visible .ref-value {
  text-decoration: underline;
}

.ref-value {
  min-width: 0;
  overflow-wrap: anywhere;
}

.related-work-row--sha .ref-chip {
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

/* No repository at all: a searchable label, visibly quieter than the rest. */
.related-work-row[data-resolution="unresolved"] .ref-chip {
  border-style: dashed;
  background: transparent;
}

.related-work-row[data-resolution="explicit"] .ref-chip {
  border-color: var(--accent-muted);
  background: var(--accent-subtle);
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

.ref-repo-inferred {
  border-bottom: 1px dashed var(--border-default);
  color: var(--text-primary);
  cursor: help;
}
</style>
