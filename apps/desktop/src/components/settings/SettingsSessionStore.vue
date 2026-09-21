<script setup lang="ts">
/**
 * Copilot session store — the enrichment preference and the bound source's state.
 *
 * Kept out of the generic feature-flag list because the preference is only half
 * the story: the toggle is meaningless without the resolved path, what the
 * source can supply, and a way to retry reading it.
 */
import { getSessionStoreStatus, refreshSessionEnrichment } from "@tracepilot/client";
import type { StoreAvailability, StoreSourceStatus } from "@tracepilot/types";
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
import { usePreferencesStore } from "@/stores/preferences";
import { logWarn } from "@/utils/logger";

const FEATURE = "sessionStoreEnrichment" as const;
const TOGGLE_LABEL = "Use the Copilot session store when available";

const preferences = usePreferencesStore();

const resolvedPath = ref<string | null>(null);
const source = ref<StoreSourceStatus | null>(null);
const statusError = ref<string | null>(null);
const refreshing = ref(false);
const refreshResult = ref<string | null>(null);

const isEnabled = computed(() => preferences.isFeatureEnabled(FEATURE));

/**
 * A store that was never installed is the ordinary state on a Copilot CLI that
 * predates it, so it is described rather than flagged as a failure.
 */
const AVAILABILITY: Record<
  StoreAvailability,
  { label: string; tone: StatusPillTone; detail: string }
> = {
  ready: {
    label: "Available",
    tone: "success",
    detail: "The store was read successfully.",
  },
  missing: {
    label: "Not installed",
    tone: "neutral",
    detail:
      "No session store exists at this path. Copilot CLI versions before the store never create one, and TracePilot never creates it either. The setting stays on so a later Copilot update is picked up automatically.",
  },
  busy: {
    label: "Busy",
    tone: "warning",
    detail:
      "The store was locked by another process when it was last read. Any cached enrichment is kept and reading is retried later.",
  },
  unreadable: {
    label: "Unreadable",
    tone: "danger",
    detail:
      "The store exists but could not be read — permissions or a damaged file. Cached enrichment is kept and marked stale.",
  },
  incompatible: {
    label: "Unsupported schema",
    tone: "warning",
    detail: "The store's schema is not one this version of TracePilot can read.",
  },
  disabled: {
    label: "Off",
    tone: "neutral",
    detail: "The source is not being read because the preference is off.",
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
  // Applying the new preference immediately is what makes the "switching it
  // off removes the cached enrichment" promise true at the moment it is made.
  await runRefresh();
}
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">Copilot Session Store</div>
    <SectionPanel>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">{{ TOGGLE_LABEL }}</div>
          <div class="setting-description">
            Reads the Copilot CLI's own session-store database, when one exists, for recorded
            request detail and linked-work references. The preference means "use this source when
            available" — a missing store never switches it off, because Copilot may be installed or
            updated later.
          </div>
          <div class="setting-description store-consequence">
            Switching it off also removes the cached enrichment TracePilot has stored, so it stops
            retention rather than only hiding the views. Your session files are never modified: the
            store is opened read-only and never created.
          </div>
        </div>
        <FormSwitch
          :model-value="isEnabled"
          :aria-label="TOGGLE_LABEL"
          @update:model-value="handleToggle"
        />
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Source</div>
          <div class="setting-description">
            Where the store would be, whether or not it exists.
          </div>
        </div>
        <span class="setting-value-display store-path">{{ resolvedPath ?? "—" }}</span>
      </div>

      <div class="setting-row setting-row-stacked">
        <div class="store-availability-head">
          <div class="setting-info">
            <div class="setting-label">Availability</div>
          </div>
          <StatusPill
            class="store-availability-pill"
            :tone="availabilityInfo.tone"
            :label="availabilityInfo.label"
          />
        </div>
        <div class="setting-description">{{ availabilityInfo.detail }}</div>
        <div v-if="source?.statusDetail" class="setting-description">{{ source.statusDetail }}</div>
        <div v-if="statusError" class="setting-description setting-result-danger">
          The status could not be read: {{ statusError }}
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Capabilities in use</div>
          <div class="setting-description">
            What this store can supply. A capability the source does not record stays unavailable.
          </div>
        </div>
        <span class="setting-value-display store-capabilities">
          {{ capabilityLabels.length > 0 ? capabilityLabels.join(", ") : "None reported" }}
        </span>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Last successful refresh</div>
          <div class="setting-description">
            The last time the store was read end to end.
          </div>
        </div>
        <span class="setting-value-display store-last-success">{{ lastSuccessLabel }}</span>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Recorded so far</div>
          <div class="setting-description">
            Totals held in the enrichment cache, not a count of everything Copilot ever did.
          </div>
        </div>
        <span class="setting-value-display store-totals">
          {{ formatNumberFull(source?.totalRequests ?? 0) }} requests across
          {{ formatNumberFull(source?.sessionsWithRequests ?? 0) }} sessions
        </span>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Retry now</div>
          <div class="setting-description">
            Re-read the store immediately instead of waiting for the next scheduled attempt.
          </div>
        </div>
        <div class="setting-actions">
          <span v-if="refreshResult" class="setting-result store-refresh-result">
            {{ refreshResult }}
          </span>
          <ActionButton
            class="store-retry-btn"
            size="sm"
            aria-label="Retry reading the Copilot session store"
            :loading="refreshing"
            @click="runRefresh"
          >
            {{ refreshing ? 'Retrying…' : 'Retry' }}
          </ActionButton>
        </div>
      </div>
    </SectionPanel>
  </div>
</template>

<style scoped>
.store-path,
.store-capabilities,
.store-totals,
.store-last-success {
  font-size: 0.75rem;
  text-align: right;
  overflow-wrap: anywhere;
  max-width: 320px;
}

.store-consequence {
  margin-top: 4px;
}

.store-availability-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}

.store-availability-pill {
  flex: none;
}

.store-refresh-result {
  max-width: 320px;
  text-align: right;
}
</style>
