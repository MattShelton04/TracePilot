import type { LaunchConfig, SessionTemplate } from "@tracepilot/types";
import { DEFAULT_CLI_COMMAND, DEFAULT_MODEL_ID, getTierLabel } from "@tracepilot/types";
import { formatCost, useClipboard, useConfirmDialog, useToast } from "@tracepilot/ui";
import {
  computed,
  type InjectionKey,
  inject,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { browseForDirectory } from "@/composables/useBrowseDirectory";
import { useGitRepository } from "@/composables/useGitRepository";
import { ROUTE_NAMES } from "@/config/routes";
import { useLauncherStore } from "@/stores/launcher";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";
import { useSessionsStore } from "@/stores/sessions";
import { useWorktreesStore } from "@/stores/worktrees";

/**
 * Central state + action coordinator for `SessionLauncherView`.
 *
 * Owns the launch form state, saved-template lifecycle, git repository
 * operations, environment variable rows, context-menu state, and the CLI
 * command preview derivations. Shared with child components via
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
  const { confirm } = useConfirmDialog();
  const { copy: copyToClipboard } = useClipboard();

  const repoPath = ref("");
  const branch = ref("");
  const selectedModel = ref("");
  const createWorktree = ref(false);
  const autoApprove = ref(false);
  const headless = ref(false);
  const uiServer = ref(false);
  const reasoningEffort = ref<"low" | "medium" | "high">("medium");
  const prompt = ref("");
  const customInstructions = ref("");
  const envVars = reactive<{ key: string; value: string }[]>([]);

  const selectedTemplateId = ref<string | null>(null);
  const showAdvanced = ref(false);
  const showTemplateForm = ref(false);
  const templateForm = reactive({ name: "", description: "", category: "", icon: "" });
  const contextMenuTpl = ref<{ id: string; x: number; y: number } | null>(null);
  const confirmingDeleteId = ref<string | null>(null);

  const baseBranch = ref("");

  const selectedModelInfo = computed(() => store.models.find((m) => m.id === selectedModel.value));
  const sdkFeatureEnabled = computed(() => prefsStore.isFeatureEnabled("copilotSdk"));

  const selectedTemplateName = computed(() => {
    if (!selectedTemplateId.value) return "Custom";
    return store.templates.find((t) => t.id === selectedTemplateId.value)?.name ?? "Custom";
  });

  const envVarsRecord = computed(() => {
    const rec: Record<string, string> = {};
    for (const e of envVars) {
      if (e.key.trim()) rec[e.key.trim()] = e.value;
    }
    return rec;
  });

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

  const launchConfig = computed<LaunchConfig>(() => ({
    repoPath: repoPath.value,
    branch: branch.value || undefined,
    baseBranch: createWorktree.value && baseBranch.value ? baseBranch.value : undefined,
    model: selectedModel.value || undefined,
    prompt: prompt.value || undefined,
    customInstructions: customInstructions.value || undefined,
    reasoningEffort: reasoningEffort.value,
    headless: headless.value,
    createWorktree: createWorktree.value,
    autoApprove: autoApprove.value,
    uiServer: !headless.value && uiServer.value,
    launchMode: headless.value ? "sdk" : "terminal",
    envVars: envVarsRecord.value,
    cliCommand: prefsStore.cliCommand || DEFAULT_CLI_COMMAND,
  }));

  const effectiveCli = computed(() => prefsStore.cliCommand || DEFAULT_CLI_COMMAND);

  const cliCommand = computed(() => {
    if (launchConfig.value.launchMode === "sdk") {
      return "Copilot SDK bridge (headless session)";
    }
    const parts = [effectiveCli.value];
    if (launchConfig.value.model) parts.push(`--model ${launchConfig.value.model}`);
    if (launchConfig.value.autoApprove) parts.push("--allow-all");
    if (launchConfig.value.uiServer) parts.push("--ui-server");
    if (launchConfig.value.reasoningEffort)
      parts.push(`--reasoning-effort ${launchConfig.value.reasoningEffort}`);
    if (launchConfig.value.prompt) {
      parts.push(`--interactive '${launchConfig.value.prompt.replace(/'/g, "''")}'`);
    }
    return parts.join(" ");
  });

  const cliCommandParts = computed<{ flag: string; value?: string }[]>(() => {
    if (launchConfig.value.launchMode === "sdk") {
      return [{ flag: "Copilot SDK bridge" }, { flag: "headless session" }];
    }
    const parts: { flag: string; value?: string }[] = [{ flag: effectiveCli.value }];
    if (launchConfig.value.model) {
      parts.push({ flag: "--model", value: launchConfig.value.model });
    }
    if (launchConfig.value.autoApprove) parts.push({ flag: "--allow-all" });
    if (launchConfig.value.uiServer) parts.push({ flag: "--ui-server" });
    if (launchConfig.value.reasoningEffort) {
      parts.push({ flag: "--reasoning-effort", value: launchConfig.value.reasoningEffort });
    }
    if (launchConfig.value.prompt) {
      parts.push({ flag: "--interactive", value: launchConfig.value.prompt });
    }
    return parts;
  });

  // Preview path for worktree creation
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

  const canLaunch = computed(() => {
    if (!repoPath.value.trim() || store.loading) return false;
    if (createWorktree.value && !branch.value.trim()) return false;
    if (launchConfig.value.launchMode === "sdk" && !sdkFeatureEnabled.value) return false;
    return true;
  });

  const defaultTemplateIds = ["default-multi-agent-review", "default-write-tests"];
  const hasDismissedDefaults = computed(() =>
    defaultTemplateIds.some((id) => !store.templates.some((t) => t.id === id)),
  );

  function tierLabel(tier: string): string {
    if (tier === "premium" || tier === "standard" || tier === "fast") {
      return getTierLabel(tier);
    }
    // For non-tier strings (e.g. reasoning effort: low/medium/high), capitalize
    return tier.charAt(0).toUpperCase() + tier.slice(1);
  }

  function extractEmoji(name: string): string {
    const match = name.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u);
    return match ? match[0] : "📄";
  }

  function templateIcon(tpl: SessionTemplate): string {
    return tpl.icon || extractEmoji(tpl.name);
  }

  function templateDisplayName(name: string): string {
    return name.replace(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u, "");
  }

  function applyTemplate(tplId: string) {
    if (selectedTemplateId.value === tplId) {
      selectedTemplateId.value = null;
      return;
    }
    const tpl = store.templates.find((t: SessionTemplate) => t.id === tplId);
    if (!tpl) return;
    selectedTemplateId.value = tplId;
    if (tpl.config.repoPath) {
      repoPath.value = tpl.config.repoPath;
    }
    branch.value = tpl.config.branch ?? "";
    selectedModel.value = tpl.config.model ?? "";
    createWorktree.value = tpl.config.createWorktree;
    baseBranch.value = tpl.config.baseBranch ?? "";
    autoApprove.value = tpl.config.autoApprove;
    headless.value = tpl.config.headless;
    uiServer.value = tpl.config.uiServer ?? false;
    reasoningEffort.value = (tpl.config.reasoningEffort as "low" | "medium" | "high") ?? "medium";
    prompt.value = tpl.config.prompt ?? "";
    customInstructions.value = tpl.config.customInstructions ?? "";
    envVars.length = 0;
    if (tpl.config.envVars) {
      for (const [k, v] of Object.entries(tpl.config.envVars)) {
        envVars.push({ key: k, value: v });
      }
    }
  }

  function clearTemplateSelection() {
    selectedTemplateId.value = null;
  }

  function moveTemplate(idx: number, direction: "up" | "down") {
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= store.templates.length) return;
    const arr = [...store.templates];
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    store.templates = arr;
  }

  async function deleteTemplateInline(tplId: string) {
    if (confirmingDeleteId.value === tplId) {
      await store.deleteTemplate(tplId);
      if (selectedTemplateId.value === tplId) selectedTemplateId.value = null;
      confirmingDeleteId.value = null;
    } else {
      confirmingDeleteId.value = tplId;
    }
  }

  function cancelDeleteInline() {
    confirmingDeleteId.value = null;
  }

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

  function addEnvVar() {
    envVars.push({ key: "", value: "" });
  }

  function removeEnvVar(idx: number) {
    envVars.splice(idx, 1);
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

  async function handleSaveTemplate() {
    if (!templateForm.name.trim()) return;
    const existing = store.templates.find(
      (t) => t.name.toLowerCase() === templateForm.name.trim().toLowerCase(),
    );
    if (existing) {
      const { confirmed } = await confirm({
        title: "Overwrite Template",
        message: `Template '${existing.name}' already exists. Do you want to overwrite it?`,
        variant: "warning",
        confirmLabel: "Overwrite",
      });
      if (!confirmed) return;
    }
    await store.saveTemplate({
      id: existing?.id ?? crypto.randomUUID(),
      name: templateForm.name,
      description: templateForm.description,
      category: templateForm.category,
      icon: templateForm.icon.trim() || undefined,
      tags: [],
      config: launchConfig.value,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      usageCount: existing?.usageCount ?? 0,
    });
    showTemplateForm.value = false;
    templateForm.name = "";
    templateForm.description = "";
    templateForm.category = "";
    templateForm.icon = "";
  }

  function openContextMenu(e: MouseEvent, tplId: string) {
    e.preventDefault();
    contextMenuTpl.value = { id: tplId, x: e.clientX, y: e.clientY };
  }

  async function deleteContextTemplate() {
    if (!contextMenuTpl.value) return;
    await store.deleteTemplate(contextMenuTpl.value.id);
    if (selectedTemplateId.value === contextMenuTpl.value.id) {
      selectedTemplateId.value = null;
    }
    contextMenuTpl.value = null;
  }

  function closeContextMenu() {
    contextMenuTpl.value = null;
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

    // Load registered repos for the dropdown, discovering from sessions if needed
    if (worktreeStore.registeredRepos.length === 0) {
      await worktreeStore.loadRegisteredRepos();
      if (worktreeStore.registeredRepos.length === 0) {
        await worktreeStore.discoverRepos();
      }
    }

    // Pre-fill from query params (e.g., navigated from Worktree Manager)
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
