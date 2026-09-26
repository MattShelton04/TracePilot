<script setup lang="ts">
import type {
  PendingRequestSummary,
  SessionRuntimeStatus,
  ToolProgressSummary,
} from "@tracepilot/types";
import { computed } from "vue";
import { useSdkSteeringContext } from "@/composables/useSdkSteering";
import { formatObjectResult } from "@/utils/formatResult";

const ctx = useSdkSteeringContext();
const live = computed(() => ctx.liveState);

const statusMeta: Record<SessionRuntimeStatus, { label: string; tone: string }> = {
  idle: { label: "Idle", tone: "idle" },
  running: { label: "Running", tone: "running" },
  waiting_for_input: { label: "Waiting for input", tone: "waiting" },
  waiting_for_permission: { label: "Waiting for permission", tone: "waiting" },
  error: { label: "Error", tone: "error" },
  shutdown: { label: "Shutdown", tone: "muted" },
  unknown: { label: "Unknown", tone: "muted" },
};

const statusLabel = computed(() => {
  const status = live.value?.status ?? "unknown";
  return statusMeta[status]?.label ?? status;
});
const statusTone = computed(() => statusMeta[live.value?.status ?? "unknown"]?.tone ?? "muted");
/**
 * Only in-flight tools are shown: finished calls render in the conversation
 * as soon as their durable events are indexed.
 */
const visibleTools = computed(() =>
  (live.value?.tools ?? []).filter((tool) => tool.status !== "complete"),
);
const usageRows = computed(() => formatUsageRows(live.value?.usage ?? null));
const title = computed(() => (ctx.isLive ? "Live from terminal" : "Live SDK stream"));
const context = computed(() => {
  const used = live.value?.contextTokens;
  const limit = live.value?.contextLimit;
  if (typeof used !== "number" || typeof limit !== "number" || limit <= 0) return null;
  const pct = Math.max(0, Math.min(100, (used / limit) * 100));
  return {
    pct,
    label: `${compactNumber(used)} / ${compactNumber(limit)}`,
    title: `Context window: ${new Intl.NumberFormat().format(used)} of ${new Intl.NumberFormat().format(limit)} tokens (${Math.round(pct)}%)`,
  };
});

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}
const hasDiagnostics = computed(
  () => !!live.value?.lastError || (live.value?.reducerWarnings.length ?? 0) > 0,
);
const warningCount = computed(() => live.value?.reducerWarnings.length ?? 0);
/**
 * After a detach the last snapshot stays in the store. Keep showing it when it
 * explains something (an error, shutdown reason or diagnostics), but not when
 * it would only say "Idle" next to the attach card.
 */
const showPanel = computed(
  () => !!live.value && (ctx.isLinked || live.value.status !== "idle" || hasDiagnostics.value),
);

function requestTitle(request: PendingRequestSummary, fallback: string): string {
  return request.summary?.trim() || requestDetail(request) || fallback;
}

function requestDetail(request: PendingRequestSummary): string | null {
  const payload = payloadRecord(request);
  if (!payload) return null;
  return (
    stringValue(payload.question) ??
    stringValue(payload.prompt) ??
    stringValue(payload.message) ??
    stringValue(payload.command) ??
    stringValue(payload.path) ??
    stringValue(payload.toolName) ??
    stringValue(payload.tool) ??
    stringValue(payload.name) ??
    null
  );
}

function requestKindLabel(request: PendingRequestSummary): string {
  return request.kind ? humanizeKey(request.kind) : "SDK request";
}

function requestChoices(request: PendingRequestSummary): string[] {
  const payload = payloadRecord(request);
  const choices = payload?.choices;
  if (!Array.isArray(choices)) return [];
  return choices
    .map((choice) => stringValue(choice))
    .filter((choice): choice is string => !!choice);
}

function requestMeta(request: PendingRequestSummary): string[] {
  const meta = [requestKindLabel(request)];
  if (request.requestId) meta.push(`Request ${shortId(request.requestId)}`);
  return meta;
}

function requestHint(kind: "input" | "permission"): string {
  return kind === "input"
    ? "Answer in Copilot CLI or the --ui-server terminal. TracePilot is showing the live SDK request, but in-app replies are not wired yet."
    : "Approve or deny in Copilot CLI or the --ui-server terminal. TracePilot is showing the live SDK request, but in-app approval is not wired yet.";
}

function payloadRecord(request: PendingRequestSummary): Record<string, unknown> | null {
  return request.payload && typeof request.payload === "object" && !Array.isArray(request.payload)
    ? (request.payload as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function toolTitle(tool: ToolProgressSummary): string {
  return tool.toolName ?? tool.toolCallId ?? "Tool activity";
}

function progressStyle(progress: number | null): { width: string } {
  const value = typeof progress === "number" && Number.isFinite(progress) ? progress : 0;
  const pct = value <= 1 ? value * 100 : value;
  return { width: `${Math.max(0, Math.min(100, pct))}%` };
}

function progressLabel(progress: number | null): string | null {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
  const pct = progress <= 1 ? progress * 100 : progress;
  return `${Math.round(Math.max(0, Math.min(100, pct)))}%`;
}

function formatPreview(value: unknown): string {
  const rendered = formatObjectResult(value).trim();
  if (rendered.length <= 1200) return rendered;
  return `${rendered.slice(0, 1200)}…`;
}

/**
 * Latest non-empty output line of a running tool. The full streaming output
 * renders inside the tool's card in the conversation (via
 * `LIVE_TOOL_PARTIAL_OUTPUT_KEY`); the panel only shows a one-line ticker so
 * the same output is never shown twice.
 */
function lastOutputLine(tool: ToolProgressSummary): string | null {
  if (tool.partialResult == null) return null;
  const text = formatObjectResult(tool.partialResult).replace(/\s+$/u, "");
  const line = text.slice(text.lastIndexOf("\n") + 1).trim();
  return line ? line.slice(0, 240) : null;
}

function formatUsageRows(usage: unknown): Array<{ key: string; value: string }> {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return usage == null ? [] : [{ key: "usage", value: formatPreview(usage) }];
  }

  const outer = usage as Record<string, unknown>;
  const record =
    outer.usage && typeof outer.usage === "object" && !Array.isArray(outer.usage)
      ? (outer.usage as Record<string, unknown>)
      : outer;
  const preferred = [
    "model",
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "reasoningTokens",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "reasoning_tokens",
    "duration",
  ];
  const keys = preferred.filter((key) => record[key] != null && isScalarUsageValue(record[key]));
  return keys.slice(0, 6).map((key) => ({
    key: humanizeKey(key).replace(/ Tokens$/u, ""),
    value: key === "duration" ? formatDurationMs(record[key]) : formatUsageValue(record[key]),
  }));
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatUsageValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "yes" : "no";
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat().format(value)
    : formatPreview(value);
}

function formatDurationMs(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return formatUsageValue(value);
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function isScalarUsageValue(value: unknown): boolean {
  return ["string", "number", "boolean"].includes(typeof value);
}
</script>

<template>
  <section v-if="showPanel && live" class="cb-live" aria-label="Live SDK session state">
    <header class="cb-live-header">
      <div class="cb-live-title">
        <span :class="['cb-live-pulse', `cb-live-pulse--${statusTone}`]" />
        <span>{{ title }}</span>
      </div>
      <div v-if="context" class="cb-live-context" :title="context.title" :aria-label="context.title">
        <span class="cb-live-context-bar"><span :style="{ width: `${context.pct}%` }" /></span>
        <span>{{ context.label }}</span>
      </div>
      <div class="cb-live-status">
        {{ statusLabel }}
        <span v-if="live.currentTurnId" class="cb-live-turn">{{ live.currentTurnId }}</span>
      </div>
    </header>

    <div v-if="live.pendingUserInput || live.pendingPermission" class="cb-live-notices">
      <article v-if="live.pendingUserInput" class="cb-live-request cb-live-request--input">
        <div class="cb-live-request-mark">?</div>
        <div class="cb-live-request-body">
          <div class="cb-live-request-kicker">
            <strong>Input needed</strong>
            <span v-for="item in requestMeta(live.pendingUserInput)" :key="item">{{ item }}</span>
          </div>
          <div class="cb-live-request-title">
            {{ requestTitle(live.pendingUserInput, "The SDK session is waiting for your response.") }}
          </div>
          <div v-if="requestChoices(live.pendingUserInput).length > 0" class="cb-live-request-choices">
            <span v-for="choice in requestChoices(live.pendingUserInput)" :key="choice">{{ choice }}</span>
          </div>
          <div class="cb-live-request-hint">{{ requestHint("input") }}</div>
        </div>
      </article>
      <article v-if="live.pendingPermission" class="cb-live-request cb-live-request--permission">
        <div class="cb-live-request-mark">!</div>
        <div class="cb-live-request-body">
          <div class="cb-live-request-kicker">
            <strong>Permission required</strong>
            <span v-for="item in requestMeta(live.pendingPermission)" :key="item">{{ item }}</span>
          </div>
          <div class="cb-live-request-title">
            {{ requestTitle(live.pendingPermission, "The SDK session is waiting for approval.") }}
          </div>
          <div class="cb-live-request-hint">{{ requestHint("permission") }}</div>
        </div>
      </article>
    </div>

    <div v-if="visibleTools.length > 0" class="cb-live-tools">
      <div class="cb-live-block-label">Running tools</div>
      <article v-for="tool in visibleTools" :key="tool.toolCallId ?? `${tool.toolName}-${tool.updatedAt}`" class="cb-live-tool">
        <div class="cb-live-tool-head">
          <span class="cb-live-tool-name">{{ toolTitle(tool) }}</span>
          <span class="cb-live-tool-status">{{ tool.status }}</span>
        </div>
        <div v-if="tool.message" class="cb-live-tool-message">{{ tool.message }}</div>
        <div v-if="progressLabel(tool.progress)" class="cb-live-progress" :aria-label="`Tool progress ${progressLabel(tool.progress)}`">
          <span :style="progressStyle(tool.progress)" />
        </div>
        <div v-if="lastOutputLine(tool)" class="cb-live-tool-tail" :title="lastOutputLine(tool) ?? undefined">
          {{ lastOutputLine(tool) }}
        </div>
      </article>
    </div>

    <div v-if="usageRows.length > 0" class="cb-live-usage" aria-label="Last model call">
      <span v-for="row in usageRows" :key="row.key" class="cb-live-usage-pill">
        <span>{{ row.key }}</span>
        <strong>{{ row.value }}</strong>
      </span>
    </div>

    <details v-if="hasDiagnostics" class="cb-live-diagnostics">
      <summary>
        <span v-if="live.lastError">SDK stream issue</span>
        <span v-else>Parser notes</span>
        <span v-if="warningCount > 0" class="cb-live-diag-count">{{ warningCount }}</span>
      </summary>
      <div v-if="live.lastError" class="cb-live-diag cb-live-diag--error">{{ live.lastError }}</div>
      <div v-for="warning in live.reducerWarnings" :key="warning" class="cb-live-diag cb-live-diag--warning">
        {{ warning }}
      </div>
    </details>
  </section>
</template>

<style scoped>
.cb-live-tool-tail {
  margin-top: 4px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.625rem;
  color: var(--text-secondary);
}
.cb-live-context {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  margin-right: 10px;
  font-size: 0.625rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary);
}
.cb-live-context-bar {
  position: relative;
  width: 56px;
  height: 4px;
  border-radius: 999px;
  background: var(--neutral-subtle);
  overflow: hidden;
}
.cb-live-context-bar > span {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: var(--accent-fg);
}
</style>
