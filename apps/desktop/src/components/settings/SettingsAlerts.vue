<script setup lang="ts">
import { ActionButton, FormSwitch, SectionPanel } from "@tracepilot/ui";
import { dispatchTestAlert } from "@/composables/useAlertDispatcher";
import { usePreferencesStore } from "@/stores/preferences";

const prefs = usePreferencesStore();

function handleTestAlert() {
  dispatchTestAlert();
}
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">Alerts &amp; Notifications</div>
    <SectionPanel>
      <div class="setting-row">
        <div>
          <div class="setting-label">Enable alerts</div>
          <div class="setting-description">
            Receive notifications from Copilot SDK-steered sessions when the agent needs input or
            encounters errors. Requires the Copilot SDK integration to be enabled and connected.
          </div>
        </div>
        <FormSwitch v-model="prefs.alertsEnabled" aria-label="Enable alerts" />
      </div>

      <template v-if="prefs.alertsEnabled">
        <div class="setting-row">
          <div>
            <div class="setting-label">Alert scope</div>
            <div class="setting-description">
              Which SDK-steered sessions to monitor for alerts.
            </div>
          </div>
          <select
            :value="prefs.alertsScope"
            class="scope-select"
            aria-label="Alert scope"
            @change="prefs.alertsScope = ($event.target as HTMLSelectElement).value as 'monitored' | 'all'"
          >
            <option value="monitored">Open sessions only</option>
            <option value="all">All running sessions</option>
          </select>
        </div>

        <div class="group-divider" />
        <div class="group-heading">Triggers</div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Agent needs input</div>
            <div class="setting-description">
              Alert when the session agent finishes its turn and is waiting for your next message.
            </div>
          </div>
          <FormSwitch v-model="prefs.alertsOnAskUser" aria-label="Alert on ask_user" />
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Session errors</div>
            <div class="setting-description">
              Alert when a running SDK-steered session encounters an error.
            </div>
          </div>
          <FormSwitch v-model="prefs.alertsOnSessionError" aria-label="Alert on session error" />
        </div>

        <div class="group-divider" />
        <div class="group-heading">Delivery</div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Native OS notifications</div>
            <div class="setting-description">
              Show alerts as system notifications (toast popups from the OS notification center).
            </div>
          </div>
          <FormSwitch
            v-model="prefs.alertsNativeNotifications"
            aria-label="Native OS notifications"
          />
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Taskbar flash</div>
            <div class="setting-description">
              Flash the taskbar icon when an alert fires while the window is unfocused.
            </div>
          </div>
          <FormSwitch v-model="prefs.alertsTaskbarFlash" aria-label="Taskbar flash" />
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Sound</div>
            <div class="setting-description">
              Play a notification sound when an alert fires.
            </div>
          </div>
          <FormSwitch v-model="prefs.alertsSoundEnabled" aria-label="Alert sound" />
        </div>

        <div class="group-divider" />
        <div class="group-heading">Behavior</div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Cooldown period</div>
            <div class="setting-description">
              Minimum seconds between alerts for the same session.
            </div>
          </div>
          <div class="cooldown-control">
            <input
              v-model.number="prefs.alertsCooldownSeconds"
              type="range"
              min="5"
              max="120"
              step="5"
              class="cooldown-slider"
              aria-label="Cooldown period in seconds"
            />
            <span class="cooldown-value">{{ prefs.alertsCooldownSeconds }}s</span>
          </div>
        </div>

        <div class="setting-row">
          <div>
            <div class="setting-label">Test notifications</div>
            <div class="setting-description">
              Send a test alert through all enabled channels to verify your setup.
            </div>
          </div>
          <ActionButton size="sm" @click="handleTestAlert">
            Send Test Alert
          </ActionButton>
        </div>
      </template>
    </SectionPanel>
  </div>
</template>

<style scoped>
.group-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: 4px 16px;
}

.group-heading {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 8px 16px 2px;
}

.scope-select {
  padding: 6px 10px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--canvas-default);
  color: var(--text-primary);
  font-size: 13px;
  min-width: 180px;
  cursor: pointer;
}

.scope-select:focus {
  outline: 2px solid var(--accent-fg);
  outline-offset: -1px;
}

.cooldown-control {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 160px;
}

.cooldown-slider {
  flex: 1;
  accent-color: var(--accent-fg);
  height: 4px;
}

.cooldown-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  min-width: 36px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
