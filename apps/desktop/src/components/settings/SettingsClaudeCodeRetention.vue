<script setup lang="ts">
/**
 * Explains that Claude Code deletes its own transcripts after
 * `cleanupPeriodDays`, so they leave TracePilot too, and how to keep them
 * longer. Shows the value in the user settings file, warns when it is low
 * or invalid, and can raise it in one click. Dismissal is remembered on
 * this machine.
 */
import {
  type ClaudeCleanupPeriod,
  getClaudeCleanupPeriod,
  raiseClaudeCleanupPeriod,
} from "@tracepilot/client";
import {
  ActionButton,
  Banner,
  FormInput,
  toErrorMessage,
  useAsyncGuard,
  useLocalStorage,
} from "@tracepilot/ui";
import { ExternalLink, History } from "lucide-vue-next";
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { logWarn } from "@/utils/logger";
import { openExternal } from "@/utils/openExternal";

const CLEANUP_DOCS_URL = "https://code.claude.com/docs/en/settings-reference#cleanupperioddays";
const DEFAULT_DAYS = 30;
/** Mirrors the backend's accepted range (`MIN/MAX_CLEANUP_PERIOD_DAYS`). */
const MIN_RAISE_DAYS = 1;
const MAX_RAISE_DAYS = 36_500;
const SUGGESTED_DAYS = 3650;

const dismissed = useLocalStorage<boolean>(STORAGE_KEYS.claudeRetentionNoticeDismissed, false);

const period = shallowRef<ClaudeCleanupPeriod | null>(null);
const failed = shallowRef(false);
const guard = useAsyncGuard();
onBeforeUnmount(() => guard.invalidate());

async function load() {
  const token = guard.start();
  failed.value = false;
  raiseResult.value = null;
  try {
    const result = await getClaudeCleanupPeriod();
    if (guard.isValid(token)) period.value = result ?? null;
  } catch (e) {
    logWarn("[SettingsClaudeCodeRetention] Failed to read cleanupPeriodDays:", e);
    if (guard.isValid(token)) failed.value = true;
  }
}

// ── One-click raise ──
const requestedDays = shallowRef<number | undefined>(SUGGESTED_DAYS);
const raising = shallowRef(false);
const raiseResult = shallowRef<{ ok: boolean; message: string } | null>(null);

/** States the backend can write over; a bad folder or file is fixed by hand. */
const canRaise = computed(() => {
  const state = period.value?.state;
  return (
    !failed.value &&
    (state === "set" || state === "notSet" || state === "noFile" || state === "valueInvalid")
  );
});
const requestValid = computed(() => {
  const days = requestedDays.value;
  return (
    typeof days === "number" &&
    Number.isInteger(days) &&
    days >= MIN_RAISE_DAYS &&
    days <= MAX_RAISE_DAYS
  );
});
/** The file already keeps transcripts at least as long; it is never lowered. */
const alreadyEnough = computed(() => {
  const current = period.value;
  return (
    requestValid.value &&
    current?.state === "set" &&
    (current.days ?? 0) >= 1 &&
    (current.days ?? 0) >= (requestedDays.value ?? 0)
  );
});
const raiseHint = computed(() => {
  if (raiseResult.value) return raiseResult.value;
  if (!requestValid.value) {
    return {
      ok: false,
      message: `Enter a whole number of days from ${MIN_RAISE_DAYS} to ${MAX_RAISE_DAYS}.`,
    };
  }
  if (alreadyEnough.value) {
    return { ok: true, message: "Your setting already keeps them at least that long." };
  }
  return null;
});

async function raise() {
  if (raising.value || !canRaise.value || !requestValid.value || alreadyEnough.value) return;
  const days = requestedDays.value as number;
  // Supersedes any read in flight, so a stale readout can't land afterwards.
  const token = guard.start();
  raising.value = true;
  raiseResult.value = null;
  try {
    const result = await raiseClaudeCleanupPeriod(days);
    if (!guard.isValid(token)) return;
    period.value = result ?? null;
    failed.value = false;
    raiseResult.value = { ok: true, message: "Saved to settings.json." };
  } catch (e) {
    logWarn("[SettingsClaudeCodeRetention] Failed to raise cleanupPeriodDays:", e);
    if (guard.isValid(token)) raiseResult.value = { ok: false, message: toErrorMessage(e) };
  } finally {
    raising.value = false;
  }
}

watch(requestedDays, () => {
  raiseResult.value = null;
});

// Read the file only while the notice shows.
watch(
  dismissed,
  (hidden) => {
    if (!hidden) void load();
  },
  { immediate: true },
);

/** The value in bold, then what it means; `warn` turns the notice amber. */
const readout = computed(() => {
  if (failed.value) return { value: "unknown", note: ".", warn: false };
  const result = period.value;
  if (!result) return null;
  const days = result.days ?? 0;
  const fallback = `, so the default of ${DEFAULT_DAYS} days applies.`;
  switch (result.state) {
    case "set":
      if (days < 1) {
        return {
          value: `${days} days`,
          note: ". Claude Code rejects values below 1; use a large value instead.",
          warn: true,
        };
      }
      return {
        value: `${days} ${days === 1 ? "day" : "days"}`,
        note: days < DEFAULT_DAYS ? `, shorter than the ${DEFAULT_DAYS}-day default.` : ".",
        warn: days < DEFAULT_DAYS,
      };
    case "notSet":
      return { value: "not set", note: fallback, warn: false };
    case "noFile":
      return { value: "not set", note: ` (no settings file)${fallback}`, warn: false };
    case "valueInvalid":
      return {
        value: "not a whole number of days",
        note: ". Claude Code may reject it.",
        warn: true,
      };
    case "folderInvalid":
      return { value: "unknown", note: ". The Claude Code folder isn't valid.", warn: true };
    case "fileInvalid":
      return {
        value: "unknown",
        note: ". The settings file couldn't be read as JSON.",
        warn: true,
      };
  }
  return null;
});
</script>

<template>
  <div v-if="!dismissed" class="setting-row claude-retention-row">
    <Banner
      :tone="readout?.warn ? 'warning' : 'info'"
      title="Older sessions disappear"
      role="note"
      dismissible
      class="claude-retention-notice"
      @dismiss="dismissed = true"
    >
      <template #icon><History :size="16" :stroke-width="1.5" /></template>
      Claude Code deletes transcripts older than <code>cleanupPeriodDays</code> (default 30
      days), so they leave TracePilot too. To keep them longer, raise it (e.g.
      <code>3650</code>) in <code>~/.claude/settings.json</code>, or <code>settings.json</code> in
      <code>CLAUDE_CONFIG_DIR</code>.
      <span v-if="readout" class="claude-retention-readout" data-testid="claude-cleanup-readout">
        Your current setting: <strong>{{ readout.value }}</strong>{{ readout.note }}
        <template v-if="period?.file && !failed">
          Checked <code class="claude-retention-file">{{ period.file }}</code>; project and
          managed settings can override it.
        </template>
      </span>
      <span v-if="canRaise" class="claude-retention-raise" data-testid="claude-cleanup-raise">
        <label class="claude-retention-raise-label" for="claude-cleanup-days">
          Keep transcripts for
        </label>
        <FormInput
          id="claude-cleanup-days"
          :model-value="requestedDays ?? ''"
          @update:model-value="requestedDays = typeof $event === 'number' ? $event : undefined"
          type="number"
          :min="MIN_RAISE_DAYS"
          :max="MAX_RAISE_DAYS"
          step="1"
          class="claude-retention-days"
          :disabled="raising"
          @keydown.enter.prevent="raise"
        />
        <span>days</span>
        <ActionButton
          size="sm"
          :loading="raising"
          :disabled="!requestValid || alreadyEnough"
          @click="raise"
        >
          Update settings.json
        </ActionButton>
        <span
          v-if="raiseHint"
          class="claude-retention-raise-hint"
          :class="{ 'claude-retention-raise-hint--error': !raiseHint.ok }"
          :role="raiseHint.ok ? 'status' : 'alert'"
        >
          {{ raiseHint.message }}
        </span>
      </span>
      <template #actions>
        <ActionButton size="sm" variant="ghost" @click="openExternal(CLEANUP_DOCS_URL)">
          Claude Code docs
          <ExternalLink :size="12" :stroke-width="1.5" aria-hidden="true" />
        </ActionButton>
      </template>
    </Banner>
  </div>
</template>

<style scoped>
.claude-retention-notice {
  flex: 1;
  min-width: 0;
}

.claude-retention-notice code {
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.claude-retention-readout {
  display: block;
  margin-top: 8px;
}

.claude-retention-file {
  overflow-wrap: anywhere;
}

.claude-retention-raise {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.claude-retention-days {
  width: 88px;
  padding: 3px 8px;
  text-align: center;
}

.claude-retention-raise-hint {
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.claude-retention-raise-hint--error {
  color: var(--danger-fg);
}
</style>
