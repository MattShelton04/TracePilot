<script setup lang="ts">
import { ActionButton, FormSwitch, SectionPanel } from "@tracepilot/ui";
import UpdateStatusIcon from "@/components/updates/UpdateStatusIcon.vue";
import { useUpdateCheck } from "@/composables/useUpdateCheck";
import { useUpdateStatus } from "@/composables/useUpdateStatus";
import { useWhatsNew } from "@/composables/useWhatsNew";
import { usePreferencesStore } from "@/stores/preferences";

const preferences = usePreferencesStore();
const { updateCheckLoading, runUpdateCheck, openUpdateInstructions } = useUpdateCheck();
const { installed, latest, hasUpdate, state, statusText } = useUpdateStatus();
const { openUpdatePreview } = useWhatsNew();
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">Updates</div>
    <SectionPanel>
      <div class="setting-row">
        <div class="update-status">
          <UpdateStatusIcon :state="state" />
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

/* Outranks the shared `.settings-root .setting-description` colour. */
.setting-info .update-status-text--error {
  color: var(--danger-fg);
}
</style>
