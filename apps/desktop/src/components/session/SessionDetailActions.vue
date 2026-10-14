<script setup lang="ts">
/**
 * SessionDetailActions — the session header's sticky action bar: resume,
 * folder, export and replay on the left; the prompt-cache chip and refresh
 * controls on the right.
 */
import { openInExplorer, resumeSessionInTerminal } from "@tracepilot/client";
import {
  resumeCommand as buildResumeCommand,
  type PromptCacheTimeline,
  type SessionSource,
  type SourceCapabilities,
} from "@tracepilot/types";
import { toErrorMessage, useClipboard, useToast } from "@tracepilot/ui";
import {
  AlertTriangle,
  Check,
  Clapperboard,
  Clipboard,
  FolderOpen,
  Play,
  Share,
} from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import type { Router } from "vue-router";
import RefreshToolbar from "@/components/RefreshToolbar.vue";
import PromptCacheHeaderChip from "@/components/session/PromptCacheHeaderChip.vue";
import { useWindowRole } from "@/composables/useWindowRole";
import { usePreferencesStore } from "@/stores/preferences";
import { logError } from "@/utils/logger";

const props = defineProps<{
  /** The id the panel was opened with (titles and replay route). */
  sessionId: string;
  /** The loaded session's id, falling back to {@link sessionId}. */
  resolvedSessionId: string;
  router?: Router | null;
  source: SessionSource;
  capabilities: SourceCapabilities;
  /** The session's folder as its provider reports it. */
  folder: string | null;
  /** The session's process is running, so resuming asks first. */
  active: boolean;
  refreshing: boolean;
  showPromptCache: boolean;
  promptCache: PromptCacheTimeline | null;
}>();

const emit = defineEmits<{ refresh: [] }>();

const prefs = usePreferencesStore();
const { isViewer } = useWindowRole();
const { copy, copied } = useClipboard();
const toast = useToast();

const confirmingCopy = ref(false);
const confirmingResume = ref(false);

async function openSessionFolder() {
  const path = props.folder;
  if (!path) return;
  try {
    await openInExplorer(path);
  } catch (e) {
    logError("[sessionDetail] Failed to open folder:", e);
    toast.error(`Couldn't open the session folder: ${toErrorMessage(e)}`);
  }
}

/** The command the user copies to resume in their own terminal, if the source has one. */
const resumeCommand = computed(() =>
  buildResumeCommand(props.source, props.resolvedSessionId, {
    copilot: prefs.cliCommand,
    claudeCode: prefs.claudeCliCommand,
  }),
);

async function copyResumeCommand() {
  if (!resumeCommand.value) return;
  if (props.active && !confirmingCopy.value) {
    confirmingCopy.value = true;
    return;
  }
  confirmingCopy.value = false;
  await copy(resumeCommand.value);
}

function cancelCopy() {
  confirmingCopy.value = false;
}

async function resumeInTerminal() {
  if (props.active && !confirmingResume.value) {
    confirmingResume.value = true;
    return;
  }
  confirmingResume.value = false;
  try {
    // The backend resumes other sources through their own configured CLI, and
    // Copilot through its default when the setting is blank.
    const copilotCli =
      props.source === "copilot" ? prefs.cliCommand.trim() || undefined : undefined;
    await resumeSessionInTerminal(props.resolvedSessionId, copilotCli);
  } catch (e) {
    logError("[sessionDetail] Failed to open terminal:", e);
    toast.error(`Couldn't resume the session in a terminal: ${toErrorMessage(e)}`);
  }
}

function cancelResume() {
  confirmingResume.value = false;
}

watch(
  () => props.active,
  (active) => {
    if (!active) {
      confirmingCopy.value = false;
      confirmingResume.value = false;
    }
  },
);
</script>

<template>
  <div class="detail-actions">
    <div class="detail-actions-left">
      <template v-if="resumeCommand">
        <template v-if="confirmingCopy">
          <span class="resume-warning"><AlertTriangle :size="14" aria-hidden="true" /> Session is active elsewhere</span>
          <button class="resume-btn resume-btn--confirm" @click="copyResumeCommand">
            Copy Anyway
          </button>
          <button class="resume-btn resume-btn--cancel" @click="cancelCopy">Cancel</button>
        </template>
        <button
          v-else
          class="resume-btn"
          @click="copyResumeCommand"
          :title="`Copy: ${resumeCommand}`"
        >
          <component :is="copied ? Check : Clipboard" :size="14" aria-hidden="true" />
          {{ copied ? 'Copied!' : 'Copy Resume Command' }}
        </button>

        <template v-if="!isViewer() && capabilities.canResumeInTerminal">
          <template v-if="confirmingResume">
            <span class="resume-warning"><AlertTriangle :size="14" aria-hidden="true" /> Session is active elsewhere</span>
            <button class="resume-btn resume-btn--confirm" @click="resumeInTerminal">
              Resume Anyway
            </button>
            <button class="resume-btn resume-btn--cancel" @click="cancelResume">Cancel</button>
          </template>
          <button
            v-else
            class="resume-btn"
            @click="resumeInTerminal"
            :title="`Resume session ${sessionId} in a new terminal`"
          >
            <Play :size="14" aria-hidden="true" />
            Resume in Terminal
          </button>
        </template>
      </template>

      <button
        v-if="!isViewer() && folder"
        class="resume-btn"
        @click="openSessionFolder"
        title="Open the session's folder in the file explorer"
      >
        <FolderOpen :size="14" aria-hidden="true" />
        Open Folder
      </button>

      <button
        v-if="!isViewer() && prefs.isFeatureEnabled('exportView') && router"
        class="resume-btn"
        :title="`Export session ${sessionId}`"
        @click="router!.push({ name: 'export', query: { sessionId: resolvedSessionId } })"
      >
        <Share :size="14" aria-hidden="true" />
        Export
      </button>

      <button
        v-if="prefs.isFeatureEnabled('sessionReplay') && router"
        class="resume-btn"
        @click="router!.push({ name: 'replay', params: { id: sessionId } })"
        title="Open session in step-by-step replay view"
      >
        <Clapperboard :size="14" aria-hidden="true" />
        Replay
      </button>
    </div>

    <div class="detail-actions-right">
      <PromptCacheHeaderChip
        v-if="showPromptCache"
        :timeline="promptCache"
      />
      <RefreshToolbar
        :refreshing="refreshing"
        :auto-refresh-enabled="prefs.autoRefreshEnabled"
        :interval-seconds="prefs.autoRefreshIntervalSeconds"
        @refresh="emit('refresh')"
        @update:auto-refresh-enabled="prefs.autoRefreshEnabled = $event"
        @update:interval-seconds="prefs.autoRefreshIntervalSeconds = $event"
      />
    </div>
  </div>
</template>

<style scoped>
/* The bar itself (.detail-actions) is styled by SessionDetailPanel, which pins it. */
.detail-actions-left {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.detail-actions-right {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}
.resume-warning {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--warning-fg);
  font-weight: 500;
}
.resume-warning svg {
  flex-shrink: 0;
}
.resume-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.resume-btn svg {
  flex-shrink: 0;
}
.resume-btn:hover {
  background: var(--neutral-subtle);
  border-color: var(--border-accent);
}
.resume-btn--confirm {
  color: var(--warning-fg);
  border-color: var(--warning-fg);
}
.resume-btn--confirm:hover {
  background: rgba(210, 153, 34, 0.1);
}
.resume-btn--cancel {
  color: var(--text-secondary);
}
</style>
