<script setup lang="ts">
import type { CreateWorktreeRequest, WorktreeInfo } from "@tracepilot/types";
import { LoadingSpinner, SearchableSelect, useToast } from "@tracepilot/ui";
import { computed, ref, watch } from "vue";
import { useGitRepository } from "@/composables/useGitRepository";
import { usePreferencesStore } from "@/stores/preferences";
import { useWorktreesStore } from "@/stores/worktrees";

const props = defineProps<{
  modelValue: boolean;
  lockedRepoPath: string | null;
  initialRepoPath: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "created", wt: WorktreeInfo): void;
}>();

const store = useWorktreesStore();
const prefsStore = usePreferencesStore();
const { success: toastSuccess, error: toastError } = useToast();

const newBranch = ref("");
const newBaseBranch = ref("");
const newTargetDir = ref("");
const createModalRepoPath = ref("");

const {
  defaultBranch,
  fetchingRemote,
  fetchRemote: performFetchRemote,
  loadDefaultBranch,
  computeWorktreePath,
} = useGitRepository({
  repoPath: computed(() => createModalRepoPath.value),
  onFetchSuccess: () => {
    toastSuccess("Fetched latest from remote");
  },
  onFetchError: (err) => {
    toastError(err);
  },
});

const computedWorktreePath = computed(() => {
  if (!newBranch.value.trim()) return "";
  return computeWorktreePath(newBranch.value);
});

function close() {
  emit("update:modelValue", false);
}

async function onRepoChange() {
  const repoPath = createModalRepoPath.value;
  if (!repoPath) return;
  store.loadBranches(repoPath);
  await loadDefaultBranch();
  newBaseBranch.value = defaultBranch.value;
}

async function handleFetchRemote() {
  await performFetchRemote();
  const repoPath = createModalRepoPath.value;
  if (repoPath) {
    await store.loadBranches(repoPath);
  }
}

async function handleCreate() {
  if (!newBranch.value.trim()) return;
  const repoPath = createModalRepoPath.value;
  if (!repoPath) return;

  const request: CreateWorktreeRequest = {
    repoPath,
    branch: newBranch.value.trim(),
    baseBranch: newBaseBranch.value.trim() || defaultBranch.value || undefined,
    targetDir: newTargetDir.value.trim() || undefined,
  };
  const result = await store.addWorktree(request);
  if (result) {
    emit("update:modelValue", false);
    prefsStore.addRecentRepoPath(repoPath);
    toastSuccess(`Created worktree: ${result.branch}`);
    store.hydrateDiskUsage(result.path);
    emit("created", result);
  }
}

watch(
  () => props.modelValue,
  async (show) => {
    if (!show) return;
    store.clearError();
    newBranch.value = "";
    newBaseBranch.value = "";
    newTargetDir.value = "";

    createModalRepoPath.value = props.lockedRepoPath ?? props.initialRepoPath ?? "";

    if (props.lockedRepoPath) {
      store.setCurrentRepoPath(props.lockedRepoPath);
    }
    const repoPath = createModalRepoPath.value;
    if (repoPath) {
      store.loadBranches(repoPath);
      await loadDefaultBranch();
      newBaseBranch.value = defaultBranch.value;
    }
  },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="modal-overlay" @click.self="close">
        <div class="modal-dialog" role="dialog" aria-labelledby="create-wt-title">
          <div class="modal-header">
            <h2 id="create-wt-title" class="modal-title">Create Worktree</h2>
            <button class="icon-btn" aria-label="Close" @click="close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          <div class="modal-body">
            <div v-if="store.error" class="modal-error">{{ store.error }}</div>
            <div class="form-group">
              <label class="form-label" for="cw-repo">Repository</label>
              <input
                v-if="lockedRepoPath"
                id="cw-repo"
                type="text"
                class="form-input"
                :value="lockedRepoPath"
                readonly
              />
              <select
                v-else
                id="cw-repo"
                v-model="createModalRepoPath"
                class="form-input"
                @change="onRepoChange"
              >
                <option value="" disabled>Select a repository…</option>
                <option v-for="repo in store.registeredRepos" :key="repo.path" :value="repo.path">
                  {{ repo.name }} — {{ repo.path }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="cw-base">Base Branch</label>
              <SearchableSelect
                v-model="newBaseBranch"
                :options="store.branches"
                :placeholder="defaultBranch || 'Current HEAD'"
                clearable
              />
            </div>

            <div class="form-group form-group--inline">
              <button
                class="btn btn-sm"
                :disabled="fetchingRemote"
                @click="handleFetchRemote"
              >
                <LoadingSpinner v-if="fetchingRemote" size="sm" />
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                {{ fetchingRemote ? 'Fetching…' : 'Fetch Latest from Remote' }}
              </button>
            </div>

            <div class="form-group">
              <label class="form-label" for="cw-branch">New Branch Name</label>
              <input
                id="cw-branch"
                v-model="newBranch"
                type="text"
                class="form-input"
                placeholder="feature/my-branch"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="cw-path">Worktree Path</label>
              <input
                id="cw-path"
                type="text"
                class="form-input form-input--mono"
                :value="computedWorktreePath"
                readonly
              />
            </div>

            <div class="modal-tip">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-fg)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
              <span>A worktree lets you check out a branch in a separate directory so you can work on multiple branches simultaneously without stashing changes.</span>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-sm" @click="close">Cancel</button>
            <button class="btn btn-primary btn-sm" :disabled="!newBranch.trim() || !createModalRepoPath" @click="handleCreate">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Create Worktree
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
