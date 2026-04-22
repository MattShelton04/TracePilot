import {
  checkSystemDeps,
  deleteSessionTemplate as deleteTemplateApi,
  getAvailableModels,
  incrementTemplateUsage as incrementUsageApi,
  launchSession as launchSessionApi,
  listSessionTemplates,
  restoreDefaultTemplates as restoreDefaultsApi,
  saveSessionTemplate as saveTemplateApi,
} from "@tracepilot/client";
import type {
  LaunchConfig,
  LaunchedSession,
  ModelInfo,
  SessionTemplate,
  SystemDependencies,
} from "@tracepilot/types";
import { runMutation, toErrorMessage, useAsyncGuard } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { logWarn } from "@/utils/logger";
import { allSettledRecord } from "@/utils/settledRecord";
import { aggregateSettledErrors } from "@/utils/settleErrors";

export const useLauncherStore = defineStore("launcher", () => {
  const models = ref<ModelInfo[]>([]);
  const templates = ref<SessionTemplate[]>([]);
  const recentLaunches = ref<LaunchedSession[]>([]);
  const systemDeps = ref<SystemDependencies | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const initializeGuard = useAsyncGuard();

  const isReady = computed(
    () => systemDeps.value?.gitAvailable && systemDeps.value?.copilotAvailable,
  );

  const modelsByTier = computed(() => {
    const tiers: Record<string, ModelInfo[]> = {};
    for (const m of models.value) {
      // biome-ignore lint/suspicious/noAssignInExpressions: intentional nullish-coalescing assignment for grouping
      (tiers[m.tier] ??= []).push(m);
    }
    return tiers;
  });

  async function initialize() {
    const token = initializeGuard.start();
    loading.value = true;
    error.value = null;
    try {
      const settled = await allSettledRecord({
        deps: checkSystemDeps(),
        models: getAvailableModels(),
        templates: listSessionTemplates(),
      });
      if (!initializeGuard.isValid(token)) return;
      if (settled.deps.status === "fulfilled") systemDeps.value = settled.deps.value;
      if (settled.models.status === "fulfilled") models.value = settled.models.value;
      if (settled.templates.status === "fulfilled") templates.value = settled.templates.value;
      error.value = aggregateSettledErrors(Object.values(settled));
    } catch (e) {
      if (!initializeGuard.isValid(token)) return;
      error.value = toErrorMessage(e);
    } finally {
      if (initializeGuard.isValid(token)) loading.value = false;
    }
  }

  async function launch(config: LaunchConfig): Promise<LaunchedSession | null> {
    return runMutation(error, async () => {
      const session = await launchSessionApi(config);
      recentLaunches.value = [session, ...recentLaunches.value.slice(0, 9)];
      return session;
    });
  }

  async function saveTemplate(template: SessionTemplate): Promise<boolean> {
    const ok = await runMutation(error, async () => {
      await saveTemplateApi(template);
      templates.value = await listSessionTemplates();
      return true as const;
    });
    return ok ?? false;
  }

  async function deleteTemplate(id: string): Promise<boolean> {
    const ok = await runMutation(error, async () => {
      await deleteTemplateApi(id);
      templates.value = templates.value.filter((t) => t.id !== id);
      return true as const;
    });
    return ok ?? false;
  }

  async function restoreDefaults(): Promise<boolean> {
    const ok = await runMutation(error, async () => {
      await restoreDefaultsApi();
      templates.value = await listSessionTemplates();
      return true as const;
    });
    return ok ?? false;
  }

  async function incrementUsage(id: string): Promise<void> {
    try {
      await incrementUsageApi(id);
      // Update local count optimistically
      const tpl = templates.value.find((t) => t.id === id);
      if (tpl) tpl.usageCount += 1;
    } catch (e) {
      // Non-critical — don't surface errors for usage tracking
      logWarn("[launcher] Failed to increment template usage", { id, error: e });
    }
  }

  function clearError() {
    error.value = null;
  }

  return {
    models,
    templates,
    recentLaunches,
    systemDeps,
    loading,
    error,
    isReady,
    modelsByTier,
    initialize,
    launch,
    saveTemplate,
    deleteTemplate,
    restoreDefaults,
    incrementUsage,
    clearError,
  };
});
