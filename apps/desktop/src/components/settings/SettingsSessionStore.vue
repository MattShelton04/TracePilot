<script setup lang="ts">
/**
 * Copilot session store — the enrichment preference and the bound source's state.
 *
 * Kept out of the generic feature-flag list because the preference is only half
 * the story: the toggle needs the source's status and a way to read it again.
 * Experimental, because the store is an internal Copilot CLI database whose
 * layout has already changed between releases.
 */
import { getSessionStoreStatus, refreshSessionEnrichment } from "@tracepilot/client";
import type { RefreshFailure, StoreAvailability, StoreSourceStatus } from "@tracepilot/types";
import {
  ActionButton,
  FormSwitch,
  formatDate,
  formatNumberFull,
  SectionPanel,
  StatusPill,
  type StatusPillTone,
  toErrorMessage,
} from "@tracepilot/ui";
import { computed, onMounted, ref } from "vue";
import SettingsFeatureGroupHeader from "@/components/settings/SettingsFeatureGroupHeader.vue";
import { usePreferencesStore } from "@/stores/preferences";
import { logWarn } from "@/utils/logger";

const FEATURE = "sessionStoreEnrichment" as const;
const TOGGLE_LABEL = "Use the Copilot session store";

const preferences = usePreferencesStore();

const resolvedPath = ref<string | null>(null);
const source = ref<StoreSourceStatus | null>(null);
/** A readable store can still fail to refresh; its status row would not say so. */
const lastRefreshError = ref<RefreshFailure | null>(null);
const statusError = ref<string | null>(null);
const refreshing = ref(false);
const refreshResult = ref<string | null>(null);

const isEnabled = computed(() => preferences.isFeatureEnabled(FEATURE));

/**
 * A store that was never installed is the ordinary state on a Copilot CLI that
 * predates it, so it is described rather than flagged as a failure. A ready
 * store needs no sentence at all.
 */
const AVAILABILITY: Record<
  StoreAvailability,
  { label: string; tone: StatusPillTone; detail: string }
> = {
  ready: { label: "Available", tone: "success", detail: "" },
  missing: {
    label: "Not installed",
    tone: "neutral",
    detail:
      "No store at this path yet; older Copilot CLI versions do not create one. The setting stays on so a later update is picked up.",
  },
  busy: {
    label: "Busy",
    tone: "warning",
    detail:
      "Another process had the store locked. Cached data is kept and reading retries automatically.",
  },
  unreadable: {
    label: "Unreadable",
    tone: "danger",
    detail:
      "The store exists but could not be read (permissions or a damaged file). Cached data is kept.",
  },
  incompatible: {
    label: "Unsupported schema",
    tone: "warning",
    detail: "This store's schema is not one TracePilot can read yet.",
  },
  disabled: {
    label: "Off",
    tone: "neutral",
    detail: "Nothing is read, and data cached from the store has been removed.",
  },
};

const availability = computed<StoreAvailability>(() => {
  if (!isEnabled.value) return "disabled";
  return source.value?.availability ?? "missing";
});

const availabilityInfo = computed(() => AVAILABILITY[availability.value]);

const CAPABILITY_LABELS: Record<string, string> = {
  requests: "Request detail",
  workRefs: "Linked work",
  sessions: "Session records",
  billing: "Billing entries",
};

const capabilityLabels = computed(() =>
  (source.value?.capabilities ?? []).map((name) => CAPABILITY_LABELS[name] ?? name),
);

const lastSuccessLabel = computed(() => {
  const at = source.value?.lastSuccessAt;
  return at ? formatDate(at) : "Never";
});

async function loadStatus() {
  try {
    const status = await getSessionStoreStatus();
    resolvedPath.value = status.resolvedPath;
    source.value = status.source;
    lastRefreshError.value = status.lastRefreshError;
    statusError.value = null;
  } catch (e) {
    // The status panel is diagnostic; a failure here must not block Settings.
    logWarn("[SettingsSessionStore] Failed to read session-store status:", e);
    statusError.value = toErrorMessage(e);
  }
}

onMounted(loadStatus);

/**
 * Refresh is also the purge path: with the preference off the backend drops the
 * enrichment rows it owns, so the toggle controls retention and not just
 * visibility.
 */
async function runRefresh() {
  if (refreshing.value) return;
  refreshing.value = true;
  refreshResult.value = null;
  try {
    const result = await refreshSessionEnrichment();
    const counts = `${formatNumberFull(result.refreshed)} refreshed, ${formatNumberFull(result.unchanged)} unchanged, ${formatNumberFull(result.skipped)} skipped`;
    refreshResult.value = result.detail ? `${counts} — ${result.detail}` : counts;
  } catch (e) {
    refreshResult.value = `Error: ${toErrorMessage(e)}`;
  } finally {
    refreshing.value = false;
    await loadStatus();
  }
}

async function handleToggle() {
  preferences.toggleFeature(FEATURE);
  try {
    await preferences.persistNow();
    await runRefresh();
  } catch (error) {
    statusError.value = `Could not save the preference: ${toErrorMessage(error)}`;
  }
}
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">Copilot Session Store</div>
    <SettingsFeatureGroupHeader
      label="Experimental"
      tone="experimental"
      tooltip="Reads an internal Copilot CLI database whose layout can change between Copilot releases."
    />
    <SectionPanel class="experimental-panel">
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">{{ TOGGLE_LABEL }}</div>
          <div class="setting-description">
            Adds per-request credits, timing and cache reads, plus linked PRs and issues, from
            Copilot CLI's session store. Read-only; turning this off removes what TracePilot
            cached from it.
          </div>
        </div>
        <FormSwitch
          :model-value="isEnabled"
          :aria-label="TOGGLE_LABEL"
          @update:model-value="handleToggle"
        />
      </div>

      <div class="setting-row setting-row-stacked">
        <div class="store-status-head">
          <div class="setting-info">
            <div class="setting-label store-status-label">
              Status
              <StatusPill
                class="store-availability-pill"
                :tone="availabilityInfo.tone"
                :label="availabilityInfo.label"
              />
            </div>
            <div class="setting-description">
              Last read: <span class="store-last-success">{{ lastSuccessLabel }}</span>
              · <span class="store-totals">{{ formatNumberFull(source?.totalRequests ?? 0) }} requests across
              {{ formatNumberFull(source?.sessionsWithRequests ?? 0) }} sessions</span>
            </div>
          </div>
          <div class="setting-actions">
            <span v-if="refreshResult" class="setting-result store-refresh-result">
              {{ refreshResult }}
            </span>
            <ActionButton
              class="store-retry-btn"
              size="sm"
              aria-label="Read the Copilot session store now"
              :loading="refreshing"
              @click="runRefresh"
            >
              {{ refreshing ? "Reading…" : "Read now" }}
            </ActionButton>
          </div>
        </div>
        <div v-if="availabilityInfo.detail" class="setting-description">
          {{ availabilityInfo.detail }}
        </div>
        <div v-if="source?.statusDetail" class="setting-description">{{ source.statusDetail }}</div>
        <div v-if="statusError" class="setting-description setting-result-danger">
          The status could not be read: {{ statusError }}
        </div>
        <div
          v-if="isEnabled && lastRefreshError"
          class="setting-description setting-result-danger"
          data-testid="store-refresh-failure"
        >
          The latest refresh failed ({{ formatDate(lastRefreshError.at) }}):
          {{ lastRefreshError.message }}. Views show data as of the last successful refresh.
        </div>
        <div class="setting-description store-meta">
          <span class="store-path">{{ resolvedPath ?? "—" }}</span>
          ·
          <span class="store-capabilities">{{
            capabilityLabels.length > 0 ? capabilityLabels.join(", ") : "None reported"
          }}</span>
        </div>
      </div>
    </SectionPanel>
  </div>
</template>

<style scoped>
.store-status-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.store-status-label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.store-meta {
  color: var(--text-tertiary);
  overflow-wrap: anywhere;
}

.store-refresh-result {
  max-width: 320px;
  text-align: right;
}

.experimental-panel {
  border-color: var(--warning-muted);
}
</style>
