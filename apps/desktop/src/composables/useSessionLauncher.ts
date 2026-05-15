import { DEFAULT_MODEL_ID } from "@tracepilot/types";
import { formatCost, useClipboard, useToast } from "@tracepilot/ui";
import { computed, type InjectionKey, inject, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { browseForDirectory } from "@/composables/useBrowseDirectory";
import { useGitRepository } from "@/composables/useGitRepository";
import { ROUTE_NAMES } from "@/config/routes";
import { useLauncherStore } from "@/stores/launcher";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";
import { useSessionsStore } from "@/stores/sessions";
import { useWorktreesStore } from "@/stores/worktrees";
import { useLauncherCliPreview } from "./sessionLauncher/useLauncherCliPreview";
import { useLauncherForm } from "./sessionLauncher/useLauncherForm";
import { useLauncherTemplates } from "./sessionLauncher/useLauncherTemplates";

export type { CliPart, ReasoningEffort } from "./sessionLauncher/types";

/**
 * Central state + action coordinator for `SessionLauncherView`.
 *
 * Internally composed from three focused composables:
 *   - `useLauncherForm` — reactive form state, validation, launchConfig
 *   - `useLauncherTemplates` — template selection, lifecycle, context menu
 *   - `useLauncherCliPreview` — derived CLI preview (single source via
 *     `buildLaunchCliArgs`)
 *
 * The flat exported API is preserved for backwards compatibility with
 * `SessionLauncherView` and child components that consume it via
 * `provide`/`inject` (`SessionLauncherKey` + `useSessionLauncherContext`).
 */
export function useSessionLauncher() {
  const store = useLauncherStore();
  const prefsStore = usePreferencesStore();
  const worktreeStore = useWorktreesStore();
  const route = useRoute();
  const router = useRouter();
  const launching = ref(false);
  const { success: toastSuccess, error: toastError } = useToast();
  const { copy: copyToClipboard } = useClipboard();

  const sdkFeatureEnabled = computed(() => prefsStore.isFeatureEnabled("copilotSdk"));
  const storeLoading = computed(() => store.loading);

  const form = useLauncherForm({ sdkFeatureEnabled, loading: storeLoading });
  const {
    repoPath,
    branch,
    baseBranch,
    selectedModel,
    createWorktree,
    autoApprove,
    headless,
    uiServer,
    reasoningEffort,
    prompt,
    customInstructions,
    envVars,
    launchConfig,
    canLaunch,
    addEnvVar,
    removeEnvVar,
  } = form;

  const templates = useLauncherTemplates({ form, launchConfig });
  const {
    selectedTemplateId,
    showAdvanced,
    showTemplateForm,
    templateForm,
    contextMenuTpl,
    confirmingDeleteId,
    selectedTemplateName,
    hasDismissedDefaults,
    tierLabel,
    templateIcon,
    templateDisplayName,
    applyTemplate,
    clearTemplateSelection,
    moveTemplate,
    deleteTemplateInline,
    cancelDeleteInline,
    openContextMenu,
    deleteContextTemplate,
    closeContextMenu,
    handleSaveTemplate,
  } = templates;

  const { cliCommand, cliCommandParts } = useLauncherCliPreview(launchConfig);

  const selectedModelInfo = computed(() => store.models.find((m) => m.id === selectedModel.value));

  const {
    defaultBranch,
    fetchingRemote,
    fetchRemote: performFetchRemote,
    computeWorktreePath,
  } = useGitRepository({
    repoPath,
    onFetchSuccess: async () => {
      await worktreeStore.loadBranches(repoPath.value);
      toastSuccess("Fetched latest from remote");
    },
    onFetchError: (error) => {
      toastError(error);
    },
  });

  async function handleFetchRemote() {
    await performFetchRemote();
  }

  function resetBranch() {
    branch.value = defaultBranch.value;
    clearTemplateSelection();
  }

  const worktreePreviewPath = computed(() => {
    if (!createWorktree.value || !branch.value) return "";
    return computeWorktreePath(branch.value).replace(/\//g, "\\");
  });

  const estimatedCost = computed(() => {
    const modelId = selectedModel.value || DEFAULT_MODEL_ID;
    const pr = prefsStore.getPremiumRequests(modelId);
    const cost = pr * prefsStore.costPerPremiumRequest;
    if (pr === 0) return "Free";
    return `~${formatCost(cost)} (${pr}x premium requests)`;
  });

  function selectRecentRepo(event: Event) {
    const val = (event.target as HTMLSelectElement).value;
    if (val) {
      repoPath.value = val;
      clearTemplateSelection();
    }
  }

  async function handleBrowseRepo() {
    const dir = await browseForDirectory({ title: "Select repository directory" });
    if (dir) {
      repoPath.value = dir;
      clearTemplateSelection();
    }
  }

  async function handleLaunch() {
    if (!canLaunch.value || launching.value) return;
    launching.value = true;
    store.error = null;
    const cfg = { ...launchConfig.value };
    try {
      if (cfg.repoPath) prefsStore.addRecentRepoPath(cfg.repoPath);
      const session = await store.launch(cfg);
      if (session) {
        if (session.sdkSessionId) {
          const sdkStore = useSdkStore();
          const sessionsStore = useSessionsStore();
          try {
            await sdkStore.hydrate();
            await sdkStore.setForegroundSession(session.sdkSessionId);
            void sessionsStore.fetchSessions();
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            toastError(`SDK session launched, but TracePilot could not refresh it: ${message}`);
          }
          await router.push({
            name: ROUTE_NAMES.sessionOverview,
            params: { id: session.sdkSessionId },
          });
        }
        if (selectedTemplateId.value) {
          store.incrementUsage(selectedTemplateId.value);
        }
        toastSuccess(session.sdkSessionId ? session.sdkSessionId : `PID ${session.pid}`, {
          title: session.sdkSessionId ? "SDK session launched" : "Session launched",
          description:
            session.command +
            (session.worktreePath ? `\n📂 Worktree: ${session.worktreePath}` : ""),
          duration: 8000,
        });
      }
    } finally {
      launching.value = false;
    }
  }

  async function copyCommand() {
    const ok = await copyToClipboard(cliCommand.value);
    if (ok) toastSuccess("Command copied to clipboard");
  }

  // Note: repoPath watcher — useGitRepository already loads default branch and
  // branches when repoPath changes; this watcher keeps the worktree store's
  // branch list in sync for the <SearchableSelect> dropdowns.
  watch(repoPath, (newPath) => {
    if (newPath) {
      worktreeStore.loadBranches(newPath);
    }
  });

  onMounted(async () => {
    store.initialize();
    document.addEventListener("click", closeContextMenu);

    if (worktreeStore.registeredRepos.length === 0) {
      await worktreeStore.loadRegisteredRepos();
      if (worktreeStore.registeredRepos.length === 0) {
        await worktreeStore.discoverRepos();
      }
    }

    if (route.query.repoPath) {
      repoPath.value = String(route.query.repoPath);
      worktreeStore.loadBranches(repoPath.value);
    }
    if (route.query.branch) {
      branch.value = String(route.query.branch);
    }
    if (route.query.createWorktree === "true") {
      createWorktree.value = true;
      showAdvanced.value = true;
    }
  });

  onUnmounted(() => {
    document.removeEventListener("click", closeContextMenu);
  });

  return {
    store,
    prefsStore,
    worktreeStore,
    // form state
    repoPath,
    branch,
    selectedModel,
    createWorktree,
    autoApprove,
    headless,
    uiServer,
    reasoningEffort,
    prompt,
    customInstructions,
    envVars,
    baseBranch,
    // ui state
    launching,
    selectedTemplateId,
    showAdvanced,
    showTemplateForm,
    templateForm,
    contextMenuTpl,
    confirmingDeleteId,
    // git
    defaultBranch,
    fetchingRemote,
    handleFetchRemote,
    resetBranch,
    computeWorktreePath,
    // derived
    selectedModelInfo,
    selectedTemplateName,
    launchConfig,
    cliCommand,
    cliCommandParts,
    worktreePreviewPath,
    estimatedCost,
    sdkFeatureEnabled,
    canLaunch,
    hasDismissedDefaults,
    // helpers
    tierLabel,
    templateIcon,
    templateDisplayName,
    // actions
    applyTemplate,
    clearTemplateSelection,
    moveTemplate,
    deleteTemplateInline,
    cancelDeleteInline,
    selectRecentRepo,
    handleBrowseRepo,
    addEnvVar,
    removeEnvVar,
    handleLaunch,
    handleSaveTemplate,
    openContextMenu,
    deleteContextTemplate,
    closeContextMenu,
    copyCommand,
  };
}

export type UseSessionLauncherReturn = ReturnType<typeof useSessionLauncher>;

export const SessionLauncherKey: InjectionKey<UseSessionLauncherReturn> =
  Symbol("SessionLauncherContext");

export function useSessionLauncherContext(): UseSessionLauncherReturn {
  const ctx = inject(SessionLauncherKey);
  if (!ctx) {
    throw new Error("useSessionLauncherContext must be used within a SessionLauncherView shell");
  }
  return ctx;
}
