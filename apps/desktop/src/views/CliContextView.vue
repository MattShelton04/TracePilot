<script setup lang="ts">
import type { ContextCaptureSnapshot } from "@tracepilot/types";
import {
  ActionButton,
  EmptyState,
  ErrorAlert,
  FormInput,
  formatBytes,
  formatDateMedium,
  LoadingSpinner,
  PageHeader,
  PageShell,
  SectionPanel,
  SegmentedControl,
  Select,
  useConfirmDialog,
} from "@tracepilot/ui";
import { Camera, FileJson2, FolderOpen, GitCompareArrows } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import ContextBenchmarkDiff from "@/components/contextCapture/ContextBenchmarkDiff.vue";
import ContextCaptureProgress from "@/components/contextCapture/ContextCaptureProgress.vue";
import ContextCaptureViewer from "@/components/contextCapture/ContextCaptureViewer.vue";
import { browseForDirectory } from "@/composables/useBrowseDirectory";
import { useContextBenchmarks } from "@/composables/useContextBenchmarks";
import { usePreferencesStore } from "@/stores/preferences";
import { useWorktreesStore } from "@/stores/worktrees";

const benchmark = useContextBenchmarks();
const { confirm } = useConfirmDialog();
const prefsStore = usePreferencesStore();
const worktreeStore = useWorktreesStore();
const view = ref<"snapshots" | "compare">("snapshots");
const beforeId = ref("");
const afterId = ref("");
const beforeSnapshot = ref<ContextCaptureSnapshot | null>(null);
const afterSnapshot = ref<ContextCaptureSnapshot | null>(null);
const comparisonLoading = ref(false);

const profileOptions: Array<{ value: "isolatedBaseline" | "currentEnvironment"; label: string }> = [
  { value: "isolatedBaseline", label: "Isolated baseline" },
  { value: "currentEnvironment", label: "Repository environment" },
];
const protocolOptions = [
  { value: "openAiResponses", label: "OpenAI Responses" },
  { value: "openAiChatCompletions", label: "OpenAI Chat Completions" },
  { value: "anthropicMessages", label: "Anthropic Messages" },
];
const protocolGuidance: Record<(typeof protocolOptions)[number]["value"], string> = {
  openAiResponses:
    "Uses POST /v1/responses with top-level instructions and an ordered input array. This is the usual format for GPT-5-family models and can carry reasoning and output controls.",
  openAiChatCompletions:
    "Uses POST /v1/chat/completions with one ordered messages array, including system messages. This is the established OpenAI-compatible format used by many local and third-party models.",
  anthropicMessages:
    "Uses POST /v1/messages with a separate system field and ordered messages. Tool schemas and thinking/output controls use Anthropic's request shape.",
};
const viewOptions = computed(() => [
  { value: "snapshots", label: "Snapshots", count: benchmark.summaries.value.length },
  { value: "compare", label: "Compare" },
]);
const canStart = computed(
  () =>
    benchmark.preflight.value?.canCapture === true &&
    benchmark.model.value.trim().length > 0 &&
    (benchmark.profile.value !== "currentEnvironment" ||
      benchmark.repositoryPath.value.trim().length > 0),
);
const canCompare = computed(
  () => beforeId.value && afterId.value && beforeId.value !== afterId.value,
);

function snapshotLabel(captureId: string) {
  const item = benchmark.summaries.value.find((summary) => summary.captureId === captureId);
  if (!item) return captureId;
  const profile = item.captureScope === "cliBaseline" ? "Baseline" : "Repository";
  return `${formatDateMedium(item.capturedAt)} · CLI ${item.cliVersion} · ${profile}`;
}

function resetComparison() {
  const items = benchmark.summaries.value;
  afterId.value = items[0]?.captureId ?? "";
  beforeId.value = items[1]?.captureId ?? "";
}

async function browseRepository() {
  const selected = await browseForDirectory({
    title: "Select repository for CLI context benchmark",
    defaultPath: benchmark.repositoryPath.value,
  });
  if (selected) benchmark.repositoryPath.value = selected;
}

async function runBenchmark() {
  const captured = await benchmark.startCapture();
  if (captured && benchmark.profile.value === "currentEnvironment") {
    prefsStore.addRecentRepoPath(benchmark.repositoryPath.value);
  }
  resetComparison();
}

function selectKnownRepository(event: Event) {
  const path = (event.target as HTMLSelectElement).value;
  if (path) benchmark.repositoryPath.value = path;
}

async function loadComparison() {
  if (!canCompare.value) return;
  comparisonLoading.value = true;
  try {
    [beforeSnapshot.value, afterSnapshot.value] = await Promise.all([
      benchmark.getCapture(beforeId.value),
      benchmark.getCapture(afterId.value),
    ]);
  } finally {
    comparisonLoading.value = false;
  }
}

async function deleteSnapshot(captureId: string) {
  const { confirmed } = await confirm({
    title: "Delete benchmark snapshot?",
    message: "This permanently removes the saved request JSON and its metadata.",
    variant: "danger",
    confirmLabel: "Delete snapshot",
  });
  if (!confirmed) return;
  await benchmark.deleteCapture(captureId);
  resetComparison();
}

watch(view, (next) => {
  if (next === "compare" && canCompare.value) void loadComparison();
});

onMounted(async () => {
  await Promise.all([benchmark.setup(), prefsStore.whenReady, worktreeStore.loadRegisteredRepos()]);
  resetComparison();
});
</script>

<template>
  <PageShell>
    <ContextCaptureViewer
      v-if="benchmark.snapshot.value"
      :snapshot="benchmark.snapshot.value"
      @close="benchmark.snapshot.value = null"
      @delete="deleteSnapshot"
    />

    <ContextCaptureProgress
      v-else-if="benchmark.capturing.value"
      benchmark
      :progress="benchmark.progress.value"
      @cancel="benchmark.cancelCapture"
    />

    <div v-else class="cli-context">
      <PageHeader
        title="CLI Context"
        subtitle="Capture fresh request snapshots to track how CLI and repository context changes over time."
        icon-name="braces"
      />

      <ErrorAlert v-if="benchmark.error.value" :message="benchmark.error.value" variant="inline" />

      <SectionPanel title="New snapshot">
        <div class="capture-form">
          <div class="capture-field capture-field--profile">
            <label>Environment</label>
            <SegmentedControl v-model="benchmark.profile.value" :options="profileOptions" />
            <p v-if="benchmark.profile.value === 'isolatedBaseline'">
              Starts with an empty workspace and temporary Copilot home. Use this to compare CLI
              versions without repository or user configuration.
            </p>
            <p v-else>
              Starts in the selected repository and copies settings, MCP configuration, skills,
              prompts, and hooks into temporary storage. Authentication and session history are not
              copied.
            </p>
          </div>

          <div v-if="benchmark.profile.value === 'currentEnvironment'" class="capture-field capture-field--repository">
            <label for="benchmark-repository">Repository</label>
            <select
              v-if="worktreeStore.registeredRepos.length || prefsStore.recentRepoPaths.length"
              id="benchmark-known-repository"
              class="repository-select"
              :value="benchmark.repositoryPath.value"
              @change="selectKnownRepository"
            >
              <option value="">Choose a past repository…</option>
              <optgroup
                v-if="worktreeStore.registeredRepos.length"
                label="Registered repositories"
              >
                <option
                  v-for="repository in worktreeStore.registeredRepos"
                  :key="repository.path"
                  :value="repository.path"
                >
                  {{ repository.name }} — {{ repository.path }}
                </option>
              </optgroup>
              <optgroup v-if="prefsStore.recentRepoPaths.length" label="Recent">
                <option
                  v-for="path in prefsStore.recentRepoPaths"
                  :key="path"
                  :value="path"
                >
                  {{ path }}
                </option>
              </optgroup>
            </select>
            <div class="path-input">
              <FormInput
                id="benchmark-repository"
                v-model="benchmark.repositoryPath.value"
                placeholder="Select a repository directory"
              />
              <ActionButton @click="browseRepository"><FolderOpen :size="14" /> Browse</ActionButton>
            </div>
          </div>

          <div class="capture-field">
            <label for="benchmark-model">Model ID</label>
            <FormInput id="benchmark-model" v-model="benchmark.model.value" placeholder="gpt-5" />
          </div>

          <div class="capture-field">
            <label for="benchmark-protocol">Wire protocol</label>
            <Select
              id="benchmark-protocol"
              v-model="benchmark.protocol.value"
              :options="protocolOptions"
            />
            <p>{{ protocolGuidance[benchmark.protocol.value] }}</p>
            <p>
              This choice changes the endpoint path and JSON envelope, not just its label. Select
              the API format the model/provider expects; TracePilot rejects a different payload
              family instead of silently interpreting it as the selected one.
            </p>
          </div>

          <div class="capture-submit">
            <span v-if="benchmark.preflight.value">
              Copilot CLI {{ benchmark.preflight.value.cli.version }}
            </span>
            <ActionButton
              variant="primary"
              :disabled="!canStart"
              :loading="benchmark.loading.value"
              @click="runBenchmark"
            >
              <Camera :size="14" /> Capture snapshot
            </ActionButton>
          </div>
        </div>
      </SectionPanel>

      <div class="context-view-tabs">
        <SegmentedControl v-model="view" :options="viewOptions" />
      </div>

      <SectionPanel v-if="view === 'snapshots'" title="Saved snapshots">
        <div v-if="benchmark.loading.value" class="loading-row">
          <LoadingSpinner size="sm" /> Loading snapshots…
        </div>
        <div v-else-if="benchmark.summaries.value.length" class="snapshot-list">
          <button
            v-for="item in benchmark.summaries.value"
            :key="item.captureId"
            type="button"
            class="snapshot-row"
            @click="benchmark.openCapture(item.captureId)"
          >
            <FileJson2 :size="18" />
            <span class="snapshot-row__main">
              <strong>{{ formatDateMedium(item.capturedAt) }}</strong>
              <small>
                CLI {{ item.cliVersion }} · {{ item.model ?? 'Unknown model' }} ·
                {{ item.captureScope === 'cliBaseline' ? 'Isolated baseline' : item.repositoryPath }}
              </small>
            </span>
            <span class="snapshot-row__metrics">
              {{ formatBytes(item.rawBodyBytes) }} · {{ item.toolCount }} tools
            </span>
          </button>
        </div>
        <EmptyState
          v-else
          size="sm"
          title="No CLI context snapshots"
          description="Capture an isolated baseline or a repository environment to start a comparison history."
        >
          <template #icon><FileJson2 /></template>
        </EmptyState>
      </SectionPanel>

      <SectionPanel v-else title="Compare snapshots">
        <div v-if="benchmark.summaries.value.length >= 2" class="compare-workspace">
          <div class="compare-selectors">
            <label>
              <span>Before</span>
              <select v-model="beforeId">
                <option v-for="item in benchmark.summaries.value" :key="item.captureId" :value="item.captureId">
                  {{ snapshotLabel(item.captureId) }}
                </option>
              </select>
            </label>
            <GitCompareArrows :size="18" aria-hidden="true" />
            <label>
              <span>After</span>
              <select v-model="afterId">
                <option v-for="item in benchmark.summaries.value" :key="item.captureId" :value="item.captureId">
                  {{ snapshotLabel(item.captureId) }}
                </option>
              </select>
            </label>
            <ActionButton :disabled="!canCompare" :loading="comparisonLoading" @click="loadComparison">
              Compare
            </ActionButton>
          </div>
          <ContextBenchmarkDiff
            v-if="beforeSnapshot && afterSnapshot && !comparisonLoading"
            :before="beforeSnapshot"
            :after="afterSnapshot"
          />
        </div>
        <EmptyState
          v-else
          size="sm"
          title="Two snapshots are required"
          description="Save another benchmark snapshot to compare system instructions, tools, controls, and request size."
        />
      </SectionPanel>
    </div>
  </PageShell>
</template>

<style scoped>
.cli-context {
  min-width: 0;
}

.capture-form {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(220px, 1fr);
  gap: 18px 24px;
  padding: 20px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
  background: var(--surface-secondary);
}

.capture-field {
  display: grid;
  align-content: start;
  gap: 7px;
  min-width: 0;
}

.capture-field--profile,
.capture-field--repository,
.capture-submit {
  grid-column: 1 / -1;
}

.capture-field label,
.compare-selectors label > span {
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
}

.capture-field p {
  max-width: 900px;
  margin: 0;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  line-height: 1.5;
}

.path-input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.repository-select {
  min-width: 0;
  height: 32px;
  padding: 5px 28px 5px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  color: var(--text-primary);
}

.capture-submit {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 2px;
}

.capture-submit span {
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.context-view-tabs {
  margin: 28px 0 20px;
}

.loading-row {
  display: flex;
  min-height: 100px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-tertiary);
}

.snapshot-list {
  overflow: hidden;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
}

.snapshot-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 13px 16px;
  border: 0;
  border-bottom: 1px solid var(--border-muted);
  background: var(--canvas-default);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.snapshot-row:last-child {
  border-bottom: 0;
}

.snapshot-row:hover {
  background: var(--surface-secondary);
}

.snapshot-row > svg {
  color: var(--accent-fg);
}

.snapshot-row__main {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.snapshot-row__main small,
.snapshot-row__metrics {
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compare-workspace {
  display: grid;
  gap: 24px;
}

.compare-selectors {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto minmax(220px, 1fr) auto;
  align-items: end;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
  background: var(--surface-secondary);
}

.compare-selectors label {
  display: grid;
  gap: 6px;
}

.compare-selectors select {
  min-width: 0;
  height: 32px;
  padding: 5px 28px 5px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  color: var(--text-primary);
}

.compare-selectors > svg {
  align-self: center;
  margin-top: 18px;
  color: var(--text-tertiary);
}

@media (max-width: 760px) {
  .capture-form,
  .compare-selectors {
    grid-template-columns: 1fr;
  }

  .capture-field--profile,
  .capture-field--repository,
  .capture-submit {
    grid-column: auto;
  }

  .compare-selectors > svg {
    display: none;
  }

  .snapshot-row {
    grid-template-columns: 24px minmax(0, 1fr);
  }

  .snapshot-row__metrics {
    grid-column: 2;
  }
}
</style>
