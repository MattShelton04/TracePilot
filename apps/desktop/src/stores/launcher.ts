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
import { toErrorMessage } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useAsyncGuard } from "@/composables/useAsyncGuard";
import { logWarn } from "@/utils/logger";
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
      const [depsResult, modelsResult, templatesResult] = await Promise.allSettled([
        checkSystemDeps(),
        getAvailableModels(),
        listSessionTemplates(),
      ]);
      if (!initializeGuard.isValid(token)) return;
      if (depsResult.status === "fulfilled") systemDeps.value = depsResult.value;
      if (modelsResult.status === "fulfilled") models.value = modelsResult.value;
      if (templatesResult.status === "fulfilled") templates.value = templatesResult.value;
      error.value = aggregateSettledErrors([depsResult, modelsResult, templatesResult]);
    } catch (e) {
      if (!initializeGuard.isValid(token)) return;
      error.value = toErrorMessage(e);
    } finally {
      if (initializeGuard.isValid(token)) loading.value = false;
    }
  }

  async function launch(config: LaunchConfig): Promise<LaunchedSession | null> {
    error.value = null;
    try {
      const session = await launchSessionApi(config);
      recentLaunches.value = [session, ...recentLaunches.value.slice(0, 9)];
      return session;
    } catch (e) {
      error.value = toErrorMessage(e);
      return null;
    }
  }

  async function saveTemplate(template: SessionTemplate): Promise<boolean> {
    try {
      await saveTemplateApi(template);
      templates.value = await listSessionTemplates();
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    }
  }

  async function deleteTemplate(id: string): Promise<boolean> {
    try {
      await deleteTemplateApi(id);
      templates.value = templates.value.filter((t) => t.id !== id);
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    }
  }

  async function restoreDefaults(): Promise<boolean> {
    try {
      await restoreDefaultsApi();
      templates.value = await listSessionTemplates();
      return true;
    } catch (e) {
      error.value = toErrorMessage(e);
      return false;
    }
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
  };
});
