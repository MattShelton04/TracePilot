<script setup lang="ts">
import type { ReleaseManifestEntry } from "@tracepilot/types";
import { ActionButton, formatDateMedium, MarkdownContent, ModalDialog } from "@tracepilot/ui";
import { ArrowUpRight, Bug, Plus, RefreshCw, RotateCcw } from "lucide-vue-next";
import { computed, ref } from "vue";
import UpdateStatusPanel from "@/components/updates/UpdateStatusPanel.vue";
import type { WhatsNewKind } from "@/composables/useWhatsNew";
import { displayVersion, entriesInRange, splitReleaseNote } from "@/utils/releaseNotes";

const props = withDefaults(
  defineProps<{
    previousVersion: string;
    currentVersion: string;
    entries: ReleaseManifestEntry[];
    kind?: WhatsNewKind;
    releaseUrl?: string;
    releaseNotes?: string;
  }>(),
  { kind: "updated" },
);

const emit = defineEmits<{
  close: [];
  update: [];
  preview: [];
  "open-external": [url: string];
}>();

/** Older releases stay collapsed in the full history so the latest ones lead. */
const HISTORY_VISIBLE = 3;

const groups = [
  { key: "added", label: "Added", icon: Plus },
  { key: "changed", label: "Changed", icon: RefreshCw },
  { key: "fixed", label: "Fixed", icon: Bug },
] as const;

const relevantEntries = computed(() =>
  entriesInRange(props.entries, props.previousVersion, props.currentVersion),
);
const showAllHistory = ref(false);
const visibleEntries = computed(() =>
  props.kind === "history" && !showAllHistory.value
    ? relevantEntries.value.slice(0, HISTORY_VISIBLE)
    : relevantEntries.value,
);
const hiddenCount = computed(() => relevantEntries.value.length - visibleEntries.value.length);

const needsReindex = computed(
  () => props.kind !== "history" && relevantEntries.value.some((e) => e.requiresReindex),
);
const hasRemoteReleaseNotes = computed(() => Boolean(props.releaseNotes?.trim()));

const current = computed(() => displayVersion(props.currentVersion));
const previous = computed(() => displayVersion(props.previousVersion));

const eyebrow = computed(() => {
  switch (props.kind) {
    case "preview":
      return "Update available";
    case "history":
      return "Release notes";
    default:
      return "Updated";
  }
});
const title = computed(() =>
  props.kind === "history" ? `TracePilot ${current.value}` : `What's new in ${current.value}`,
);
const subtitle = computed(() => {
  if (props.kind === "history") return "Changes in this version and earlier releases.";
  if (!props.previousVersion || props.previousVersion === "0.0.0") return "";
  return props.kind === "preview"
    ? `You're on ${previous.value}.`
    : `Updated from ${previous.value}.`;
});

function notesFor(entry: ReleaseManifestEntry, key: (typeof groups)[number]["key"]) {
  return (entry.notes?.[key] ?? []).map(splitReleaseNote);
}
</script>

<template>
  <ModalDialog
    :visible="true"
    width="600px"
    :title="title"
    @update:visible="(open) => !open && emit('close')"
  >
    <template #header>
      <div class="wn-header">
        <span class="wn-eyebrow">{{ eyebrow }}</span>
        <h2 class="wn-title">{{ title }}</h2>
        <p v-if="subtitle" class="wn-subtitle">{{ subtitle }}</p>
      </div>
    </template>

    <div class="wn-body">
      <!-- Opened from the version number: let people check for updates here too. -->
      <UpdateStatusPanel
        v-if="kind === 'history'"
        @update="emit('update')"
        @preview="emit('preview')"
      />

      <section
        v-for="entry in visibleEntries"
        :key="entry.version"
        class="wn-version"
        :aria-label="`Release ${displayVersion(entry.version)}`"
      >
        <header v-if="relevantEntries.length > 1 || kind === 'history'" class="wn-version-header">
          <span class="wn-version-tag">{{ displayVersion(entry.version) }}</span>
          <time class="wn-version-date" :datetime="entry.date">{{ formatDateMedium(entry.date) }}</time>
        </header>

        <template v-for="group in groups" :key="group.key">
          <div v-if="entry.notes?.[group.key]?.length" class="wn-group" :class="`wn-group--${group.key}`">
            <h3 class="wn-group-title">
              <component :is="group.icon" :size="13" :stroke-width="2" aria-hidden="true" />
              {{ group.label }}
            </h3>
            <ul class="wn-list">
              <li v-for="(note, index) in notesFor(entry, group.key)" :key="index" class="wn-item">
                <strong v-if="note.title" class="wn-item-title">{{ note.title }}</strong>
                <span class="wn-item-body">{{ note.body }}</span>
              </li>
            </ul>
          </div>
        </template>
      </section>

      <button
        v-if="hiddenCount > 0"
        type="button"
        class="wn-more"
        @click="showAllHistory = true"
      >
        Show {{ hiddenCount }} earlier {{ hiddenCount === 1 ? "release" : "releases" }}
      </button>

      <div
        v-if="relevantEntries.length === 0 && hasRemoteReleaseNotes"
        class="wn-remote"
      >
        <MarkdownContent
          :content="releaseNotes ?? ''"
          @open-external="(url) => emit('open-external', url)"
        />
      </div>

      <div v-else-if="relevantEntries.length === 0" class="wn-empty">
        <p>Release notes could not be loaded for this update.</p>
        <button
          v-if="releaseUrl"
          type="button"
          class="wn-link"
          @click="emit('open-external', releaseUrl)"
        >
          View release notes on GitHub
          <ArrowUpRight :size="13" :stroke-width="2" aria-hidden="true" />
        </button>
      </div>

      <p v-if="needsReindex" class="wn-reindex" role="note">
        <RotateCcw :size="14" :stroke-width="2" aria-hidden="true" />
        <span>
          This release benefits from rebuilt analytics. Use <strong>Rebuild analytics</strong>
          in Settings → Data &amp; Storage when convenient.
        </span>
      </p>
    </div>

    <template #footer>
      <button
        v-if="releaseUrl && (relevantEntries.length > 0 || hasRemoteReleaseNotes)"
        type="button"
        class="wn-link wn-footer-link"
        @click="emit('open-external', releaseUrl)"
      >
        View on GitHub
        <ArrowUpRight :size="13" :stroke-width="2" aria-hidden="true" />
      </button>
      <template v-if="kind === 'preview'">
        <ActionButton @click="emit('close')">Not now</ActionButton>
        <ActionButton variant="primary" @click="emit('update')">Update to {{ current }}</ActionButton>
      </template>
      <ActionButton v-else variant="primary" @click="emit('close')">Got it</ActionButton>
    </template>
  </ModalDialog>
</template>

<style scoped>
.wn-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.wn-eyebrow {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--accent-fg);
}

.wn-title {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 600;
  color: var(--text-primary);
}

.wn-subtitle {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.wn-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.wn-version {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.wn-version + .wn-version {
  padding-top: 20px;
  border-top: 1px solid var(--border-muted);
}

.wn-version-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.wn-version-tag {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.wn-version-date {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.wn-group {
  --wn-tone: var(--accent-fg);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wn-group--added {
  --wn-tone: var(--success-fg);
}

.wn-group--fixed {
  --wn-tone: var(--attention-fg);
}

.wn-group-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--wn-tone);
}

.wn-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.wn-item {
  position: relative;
  padding-left: 16px;
  font-size: 0.8125rem;
  line-height: 1.55;
  color: var(--text-secondary);
}

.wn-item::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 0.62em;
  width: 5px;
  height: 5px;
  border-radius: var(--radius-full);
  background: var(--wn-tone);
  opacity: 0.8;
}

.wn-item-title {
  color: var(--text-primary);
  font-weight: 600;
}

.wn-item-title::after {
  content: " — ";
  font-weight: 400;
  color: var(--text-tertiary);
}

.wn-more {
  align-self: flex-start;
  padding: 4px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
}

.wn-more:hover {
  color: var(--text-primary);
  background: var(--neutral-subtle);
}

/* MarkdownContent sets heading and list spacing with !important. */
.wn-remote :deep(h2),
.wn-remote :deep(h3) {
  margin: 20px 0 8px !important;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--accent-fg);
}

.wn-remote :deep(.markdown-content > :first-child) {
  margin-top: 0 !important;
}

.wn-remote :deep(li) {
  font-size: 0.8125rem;
  line-height: 1.55;
  color: var(--text-secondary);
}

.wn-remote :deep(li + li) {
  margin-top: 8px !important;
}

.wn-remote :deep(strong) {
  color: var(--text-primary);
}

.wn-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  text-align: center;
}

.wn-empty p {
  margin: 0;
}

.wn-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-fg);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
}

.wn-link:hover {
  text-decoration: underline;
}

.wn-footer-link {
  margin-right: auto;
}

.wn-reindex {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 12px;
  border: 1px solid var(--warning-muted);
  border-radius: var(--radius-md);
  background: var(--attention-subtle);
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--text-secondary);
}

.wn-reindex svg {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--attention-fg);
}

.wn-reindex strong {
  color: var(--text-primary);
  font-weight: 500;
}
</style>
