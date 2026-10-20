<script setup lang="ts">
/**
 * One quiet line under the Overview's Pull requests header when TracePilot
 * can't look their state up: the setting is off, or the GitHub CLI is missing
 * or signed out. A transient failure says nothing. Dismissing it is
 * remembered on this machine, per reason.
 */
import { useLocalStorage } from "@tracepilot/ui";
import { Info, X } from "lucide-vue-next";
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useWindowRole } from "@/composables/useWindowRole";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { pushRoute, ROUTE_NAMES } from "@/router/navigation";
import {
  type PullRequestLookupNotice,
  usePullRequestStatusStore,
} from "@/stores/pullRequestStatus";

const MESSAGES: Record<PullRequestLookupNotice, string> = {
  disabled: "Pull request status lookups are off.",
  notInstalled: "Install and sign in to the GitHub CLI to see pull request status.",
  signedOut: "Sign in to the GitHub CLI to see pull request status.",
};

const status = usePullRequestStatusStore();
// Pop-outs have no router and never show the note (the store says so).
const router = useWindowRole().isMain() ? useRouter() : null;
const dismissed = useLocalStorage<string | null>(STORAGE_KEYS.pullRequestNoticeDismissed, null);

/** Not installed and signed out are one reason: the CLI isn't usable. */
const reason = computed(() => (status.notice === "disabled" ? "disabled" : "cli"));
const message = computed(() => {
  const notice = status.notice;
  return notice && dismissed.value !== reason.value ? MESSAGES[notice] : null;
});

function openSettings() {
  if (router) void pushRoute(router, ROUTE_NAMES.settings);
}

function dismiss() {
  dismissed.value = reason.value;
}
</script>

<template>
  <div v-if="message" class="pr-note" role="note" data-testid="pull-request-lookup-note">
    <Info :size="14" aria-hidden="true" class="pr-note__icon" />
    <span class="pr-note__text" :title="message">{{ message }}</span>
    <button v-if="router" type="button" class="pr-note__link" @click="openSettings">Settings</button>
    <button
      type="button"
      class="pr-note__dismiss"
      aria-label="Dismiss"
      title="Dismiss"
      data-testid="pull-request-lookup-note-dismiss"
      @click="dismiss"
    >
      <X :size="14" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.pr-note {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-muted);
  font-size: 12px;
  line-height: 16px;
  color: var(--text-tertiary);
}

.pr-note__icon {
  flex-shrink: 0;
}

.pr-note__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pr-note__link {
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: var(--text-link);
  cursor: pointer;
}

.pr-note__link:hover {
  text-decoration: underline;
}

.pr-note__dismiss {
  display: inline-flex;
  flex-shrink: 0;
  margin-left: auto;
  padding: 4px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
}

.pr-note__dismiss:hover {
  background: var(--state-hover-overlay);
  color: var(--text-primary);
}
</style>
