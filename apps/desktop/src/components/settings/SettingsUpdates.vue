<script setup lang="ts">
import {
  ActionButton,
  FormSwitch,
  formatDateMedium,
  formatRelativeTime,
  LoadingSpinner,
  SectionPanel,
} from "@tracepilot/ui";
import { AlertCircle, CheckCircle2, CircleHelp, Sparkles } from "lucide-vue-next";
import { computed } from "vue";
import { useAppVersion } from "@/composables/useAppVersion";
import { useUpdateCheck } from "@/composables/useUpdateCheck";
import { useWhatsNew } from "@/composables/useWhatsNew";
import { usePreferencesStore } from "@/stores/preferences";
import { displayVersion } from "@/utils/releaseNotes";

const preferences = usePreferencesStore();
const { appVersion } = useAppVersion();
const {
  updateResult,
  updateCheckLoading,
  updateCheckError,
  updateCheckedAt,
  runUpdateCheck,
  openUpdateInstructions,
} = useUpdateCheck();
const { openUpdatePreview } = useWhatsNew();

const installed = computed(() => displayVersion(appVersion.value));
const latest = computed(() => displayVersion(updateResult.value?.latestVersion ?? ""));
const hasUpdate = computed(() => updateResult.value?.hasUpdate === true);

type UpdateState = "checking" | "error" | "available" | "current" | "unknown";
const state = computed<UpdateState>(() => {
  if (updateCheckLoading.value) return "checking";
  if (updateCheckError.value) return "error";
  if (hasUpdate.value) return "available";
  return updateResult.value ? "current" : "unknown";
});

const checkedAgo = computed(() =>
  updateCheckedAt.value ? formatRelativeTime(updateCheckedAt.value / 1000) : "",
);

const statusText = computed(() => {
  switch (state.value) {
    case "checking":
      return "Checking GitHub for a newer release…";
    case "error":
      return `Couldn't check for updates: ${updateCheckError.value}`;
    case "available": {
      const published = formatDateMedium(updateResult.value?.publishedAt);
      return `${latest.value} is available${published ? ` · released ${published}` : ""}`;
    }
    case "current":
      return `You're up to date${checkedAgo.value ? ` · checked ${checkedAgo.value}` : ""}`;
    default:
      return "Not checked yet";
  }
});
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">Updates</div>
    <SectionPanel>
      <div class="setting-row">
        <div class="update-status">
          <span class="update-status-icon" :class="`update-status-icon--${state}`" aria-hidden="true">
            <LoadingSpinner v-if="state === 'checking'" size="sm" color="currentColor" />
            <AlertCircle v-else-if="state === 'error'" :size="16" :stroke-width="2" />
            <Sparkles v-else-if="state === 'available'" :size="16" :stroke-width="2" />
            <CheckCircle2 v-else-if="state === 'current'" :size="16" :stroke-width="2" />
            <CircleHelp v-else :size="16" :stroke-width="2" />
          </span>
          <div class="setting-info">
            <div class="setting-label">TracePilot {{ installed }}</div>
            <div
              class="setting-description update-status-text"
              :class="`update-status-text--${state}`"
              role="status"
            >
              {{ statusText }}
            </div>
          </div>
        </div>
        <div class="setting-actions">
          <ActionButton
            size="sm"
            :loading="updateCheckLoading"
            @click="runUpdateCheck(true)"
          >
            Check now
          </ActionButton>
          <ActionButton v-if="hasUpdate" size="sm" variant="primary" @click="openUpdateInstructions">
            Update to {{ latest }}
          </ActionButton>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">What's new</div>
          <div class="setting-description">
            <template v-if="hasUpdate">See what's coming in {{ latest }}.</template>
            <template v-else>Release notes for {{ installed }} and earlier versions.</template>
          </div>
        </div>
        <ActionButton size="sm" @click="openUpdatePreview">
          {{ hasUpdate ? "Preview changes" : "View release notes" }}
        </ActionButton>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Check for updates on startup</div>
          <div class="setting-description">
            Asks GitHub's API at startup, at most once a day. GitHub receives your IP address and TracePilot version.
          </div>
        </div>
        <FormSwitch v-model="preferences.checkForUpdates" aria-label="Check for updates on startup" />
      </div>
    </SectionPanel>
  </div>
</template>

<style scoped>
.update-status {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.update-status-icon {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--neutral-subtle);
  color: var(--text-tertiary);
}

.update-status-icon--available {
  background: var(--accent-subtle);
  color: var(--accent-fg);
}

.update-status-icon--current {
  background: var(--success-subtle);
  color: var(--success-fg);
}

.update-status-icon--error {
  background: var(--danger-subtle);
  color: var(--danger-fg);
}

/* Outranks the shared `.settings-root .setting-description` colour. */
.setting-info .update-status-text--error {
  color: var(--danger-fg);
}
</style>
