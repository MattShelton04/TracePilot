import type { LaunchConfig, SessionTemplate } from "@tracepilot/types";
import { DEFAULT_CLI_COMMAND } from "@tracepilot/types";
import { type ComputedRef, computed, reactive, ref } from "vue";
import { usePreferencesStore } from "@/stores/preferences";
import type { ReasoningEffort } from "./types";

/**
 * Reactive launch-form state plus its derived `launchConfig` and
 * `canLaunch` predicate.
 *
 * Owns: repoPath, branch, model, prompt, env-var rows, worktree fields,
 * advanced flags. Exposes a small `applyTemplateConfig` helper used by the
 * templates composable so it doesn't need to know the individual refs.
 */
export interface UseLauncherFormOptions {
  sdkFeatureEnabled: ComputedRef<boolean>;
  loading: ComputedRef<boolean>;
}

export function useLauncherForm(options: UseLauncherFormOptions) {
  const prefsStore = usePreferencesStore();

  const repoPath = ref("");
  const branch = ref("");
  const baseBranch = ref("");
  const selectedModel = ref("");
  const createWorktree = ref(false);
  const autoApprove = ref(false);
  const headless = ref(false);
  const uiServer = ref(false);
  const reasoningEffort = ref<ReasoningEffort>("medium");
  const prompt = ref("");
  const customInstructions = ref("");
  const envVars = reactive<{ key: string; value: string }[]>([]);

  const envVarsRecord = computed(() => {
    const rec: Record<string, string> = {};
    for (const e of envVars) {
      if (e.key.trim()) rec[e.key.trim()] = e.value;
    }
    return rec;
  });

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

  const canLaunch = computed(() => {
    if (!repoPath.value.trim() || options.loading.value) return false;
    if (createWorktree.value && !branch.value.trim()) return false;
    if (launchConfig.value.launchMode === "sdk" && !options.sdkFeatureEnabled.value) return false;
    return true;
  });

  function addEnvVar() {
    envVars.push({ key: "", value: "" });
  }

  function removeEnvVar(idx: number) {
    envVars.splice(idx, 1);
  }

  function applyTemplateConfig(tpl: SessionTemplate) {
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
    reasoningEffort.value = (tpl.config.reasoningEffort as ReasoningEffort) ?? "medium";
    prompt.value = tpl.config.prompt ?? "";
    customInstructions.value = tpl.config.customInstructions ?? "";
    envVars.length = 0;
    if (tpl.config.envVars) {
      for (const [k, v] of Object.entries(tpl.config.envVars)) {
        envVars.push({ key: k, value: v });
      }
    }
  }

  return {
    // form state
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
    // derived
    envVarsRecord,
    launchConfig,
    canLaunch,
    // actions
    addEnvVar,
    removeEnvVar,
    applyTemplateConfig,
  };
}

export type UseLauncherFormReturn = ReturnType<typeof useLauncherForm>;
