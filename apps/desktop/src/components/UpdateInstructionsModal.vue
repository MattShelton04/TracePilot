<script setup lang="ts">
import { ActionButton, formatDateMedium, ModalDialog, ProgressBar } from "@tracepilot/ui";
import { AlertCircle, ArrowRight, Info } from "lucide-vue-next";
import { computed, onMounted } from "vue";
import { useAppVersion } from "@/composables/useAppVersion";
import { useAutoUpdate } from "@/composables/useAutoUpdate";
import { useUpdateCheck } from "@/composables/useUpdateCheck";
import { openExternal } from "@/utils/openExternal";
import { displayVersion } from "@/utils/releaseNotes";

const emit = defineEmits<{
  close: [];
  "whats-new": [];
}>();

const { updateResult } = useUpdateCheck();
const { appVersion } = useAppVersion();
const { status, progress, errorMessage, installType, detectInstallType, installUpdate } =
  useAutoUpdate();

const latest = computed(() => displayVersion(updateResult.value?.latestVersion ?? ""));
const installed = computed(() =>
  displayVersion(updateResult.value?.currentVersion ?? appVersion.value),
);
const publishedAt = computed(() => formatDateMedium(updateResult.value?.publishedAt));
const releaseUrl = computed(() => updateResult.value?.releaseUrl);
const isUpdating = computed(() =>
  ["checking", "downloading", "installing", "done"].includes(status.value),
);

const statusText = computed(() => {
  switch (status.value) {
    case "checking":
      return "Preparing download…";
    case "downloading":
      return `Downloading… ${progress.value}%`;
    case "installing":
      return "Installing…";
    case "done":
      return "Restarting TracePilot…";
    default:
      return "";
  }
});

const sourceSteps = [
  { text: "Stop TracePilot in its terminal with", code: "Ctrl+C", kbd: true },
  { text: "Pull the latest code in your TracePilot folder:", code: "git pull" },
  { text: "Start TracePilot again:", code: "pnpm start" },
];

onMounted(() => detectInstallType());

function handleOpenRelease() {
  if (releaseUrl.value) openExternal(releaseUrl.value);
}
</script>

<template>
  <ModalDialog
    :visible="true"
    width="520px"
    :title="`Update to ${latest}`"
    @update:visible="(open) => !open && emit('close')"
  >
    <template #header>
      <div class="up-header">
        <span class="up-eyebrow">Update available</span>
        <h2 class="up-title">Update to {{ latest }}</h2>
        <p class="up-versions">
          <span class="up-version">{{ installed }}</span>
          <ArrowRight :size="12" :stroke-width="2" aria-label="to" />
          <span class="up-version up-version--new">{{ latest }}</span>
          <span v-if="publishedAt" class="up-published">Released {{ publishedAt }}</span>
        </p>
      </div>
    </template>

    <div class="up-body">
      <!-- Installed (NSIS/MSI): one-click update with progress -->
      <section v-if="installType === 'installed'" class="up-method" aria-label="Install automatically">
        <h3 class="up-method-title">Install automatically</h3>
        <p class="up-text">
          TracePilot downloads and installs the update, then restarts. Your sessions and settings are kept.
        </p>
        <div v-if="isUpdating" class="up-progress">
          <ProgressBar :percent="progress" aria-label="Update download progress" />
          <span class="up-progress-text" aria-live="polite">{{ statusText }}</span>
        </div>
        <p v-else-if="status === 'error'" class="up-error" role="alert">
          <AlertCircle :size="14" :stroke-width="2" aria-hidden="true" />
          <span>{{ errorMessage }}</span>
        </p>
      </section>

      <!-- Source checkout: git pull -->
      <section v-else-if="installType === 'source'" class="up-method" aria-label="Update from source">
        <h3 class="up-method-title">Update from source</h3>
        <ol class="up-steps">
          <li v-for="(step, index) in sourceSteps" :key="index" class="up-step">
            <span class="up-step-number" aria-hidden="true">{{ index + 1 }}</span>
            <span class="up-step-text">
              {{ step.text }}
              <kbd v-if="step.kbd">{{ step.code }}</kbd>
              <code v-else>{{ step.code }}</code>
            </span>
          </li>
        </ol>
      </section>

      <!-- Portable executable: download again -->
      <section v-else-if="installType === 'portable'" class="up-method" aria-label="Download the latest version">
        <h3 class="up-method-title">Download the latest version</h3>
        <p class="up-text">
          You're running the standalone <code>.exe</code>. Download {{ latest }} from GitHub Releases and
          replace your current file. The installer version updates itself in one click.
        </p>
      </section>

      <p v-if="installType === 'source'" class="up-note">
        <Info :size="14" :stroke-width="2" aria-hidden="true" />
        <span>
          If <code>git pull</code> reports conflicts, run <code>git stash</code> first, or
          <code>git reset --hard origin/main</code> to discard local changes.
        </span>
      </p>
      <p v-else-if="installType !== 'unknown'" class="up-note">
        <Info :size="14" :stroke-width="2" aria-hidden="true" />
        <span>
          TracePilot isn't code-signed, so Windows may show a SmartScreen prompt. Choose
          <strong>More info → Run anyway</strong> to continue.
        </span>
      </p>
    </div>

    <template #footer>
      <button type="button" class="up-link" @click="emit('whats-new')">
        What's new in {{ latest }}
      </button>
      <template v-if="installType === 'installed'">
        <ActionButton :disabled="isUpdating" @click="emit('close')">Not now</ActionButton>
        <ActionButton variant="primary" :loading="isUpdating" @click="installUpdate">
          {{ status === "error" ? "Try again" : "Install and restart" }}
        </ActionButton>
      </template>
      <template v-else-if="installType === 'portable' && releaseUrl">
        <ActionButton @click="emit('close')">Not now</ActionButton>
        <ActionButton variant="primary" @click="handleOpenRelease">Open GitHub Releases</ActionButton>
      </template>
      <ActionButton v-else variant="primary" @click="emit('close')">Done</ActionButton>
    </template>
  </ModalDialog>
</template>

<style scoped>
.up-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.up-eyebrow {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--accent-fg);
}

.up-title {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 600;
  color: var(--text-primary);
}

.up-versions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 4px 0 0;
  color: var(--text-tertiary);
}

.up-version {
  padding: 0 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--text-secondary);
}

.up-version--new {
  border-color: var(--accent-muted);
  background: var(--accent-subtle);
  color: var(--accent-fg);
}

.up-published {
  font-size: 0.75rem;
}

.up-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.up-method {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.up-method-title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.up-text {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.55;
  color: var(--text-secondary);
}

.up-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.up-step {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 0.8125rem;
  line-height: 1.6;
  color: var(--text-secondary);
}

.up-step-number {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-full);
  background: var(--neutral-subtle);
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.up-progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}

.up-progress :deep(.progress-bar-fill) {
  transition: none;
}

.up-progress-text {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.up-error,
.up-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  font-size: 0.75rem;
  line-height: 1.55;
}

.up-error svg,
.up-note svg {
  flex-shrink: 0;
  margin-top: 2px;
}

.up-error {
  background: var(--danger-subtle);
  color: var(--danger-fg);
}

.up-note {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-muted);
  color: var(--text-secondary);
}

.up-note svg {
  color: var(--text-tertiary);
}

.up-note strong {
  font-weight: 500;
  color: var(--text-primary);
}

code,
kbd {
  padding: 1px 4px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  white-space: nowrap;
}

code {
  background: var(--canvas-inset);
  color: var(--text-primary);
}

kbd {
  border: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  color: var(--text-primary);
}

.up-link {
  margin-right: auto;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-fg);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
}

.up-link:hover {
  text-decoration: underline;
}
</style>
