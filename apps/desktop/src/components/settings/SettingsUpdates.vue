<script setup lang="ts">
import { ActionButton, FormSwitch, SectionPanel } from '@tracepilot/ui';
import { useAppVersion } from '@/composables/useAppVersion';
import { useUpdateCheck } from '@/composables/useUpdateCheck';
import { useWhatsNew } from '@/composables/useWhatsNew';
import { openExternal } from '@/utils/openExternal';
import { usePreferencesStore } from '@/stores/preferences';

const preferences = usePreferencesStore();
const { appVersion } = useAppVersion();
const { updateResult, updateCheckLoading, updateCheckError, runUpdateCheck } = useUpdateCheck();
const { openWhatsNew } = useWhatsNew();

async function handleCheckForUpdates() {
  await runUpdateCheck(true);
}

async function handleViewWhatsNew() {
  await openWhatsNew('0.0.0', appVersion.value);
}

function handleOpenRelease() {
  if (updateResult.value?.releaseUrl) {
    openExternal(updateResult.value.releaseUrl);
  }
}
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">Updates</div>
    <SectionPanel>
      <div class="setting-row">
        <div>
          <div class="setting-label">Check for updates on startup</div>
          <div class="setting-description">
            When enabled, TracePilot will contact GitHub's API to check for new releases.
            Your IP address and software version will be sent to GitHub.
          </div>
        </div>
        <FormSwitch v-model="preferences.checkForUpdates" />
      </div>

      <div class="setting-row">
        <div>
          <div class="setting-label">Manual update check</div>
          <div class="setting-description">
            Check GitHub for a newer version of TracePilot right now.
          </div>
        </div>
        <ActionButton
          size="sm"
          :disabled="updateCheckLoading"
          @click="handleCheckForUpdates"
        >
          {{ updateCheckLoading ? 'Checking…' : 'Check Now' }}
        </ActionButton>
      </div>

      <div class="setting-row">
        <div>
          <div class="setting-label">What's New</div>
          <div class="setting-description">
            View the release notes for your current version.
          </div>
        </div>
        <ActionButton size="sm" @click="handleViewWhatsNew">
          View Release Notes
        </ActionButton>
      </div>
      <div v-if="updateResult && !updateCheckLoading" class="setting-row">
        <div class="update-check-result">
          <template v-if="updateResult.hasUpdate">
            🎉 <strong>v{{ updateResult.latestVersion }}</strong> is available!
            <a
              v-if="updateResult.releaseUrl"
              href="#"
              class="release-link"
              @click.prevent="handleOpenRelease"
            >
              View release →
            </a>
          </template>
          <template v-else>
            ✓ You're running the latest version (v{{ updateResult.currentVersion }}).
          </template>
        </div>
      </div>
      <div v-if="updateCheckError" class="setting-row">
        <div class="update-check-error">
          ⚠️ {{ updateCheckError }}
        </div>
      </div>
    </SectionPanel>
  </div>
</template>

<style scoped>
.update-check-result {
  font-size: 13px;
  color: var(--color-fg-default);
  line-height: 1.5;
}

.update-check-result a {
  color: var(--color-accent-fg);
  text-decoration: none;
  margin-left: 6px;
}

.update-check-result a:hover {
  text-decoration: underline;
}

.update-check-error {
  font-size: 13px;
  color: var(--color-danger-fg, #ef4444);
}
</style>
