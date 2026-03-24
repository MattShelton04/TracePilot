import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  LaunchConfig,
  LaunchedSession,
  ModelInfo,
  SessionTemplate,
  SystemDependencies,
} from '@tracepilot/types';
import {
  launchSession as launchSessionApi,
  getAvailableModels,
  listSessionTemplates,
  saveSessionTemplate as saveTemplateApi,
  deleteSessionTemplate as deleteTemplateApi,
  restoreDefaultTemplates as restoreDefaultsApi,
  incrementTemplateUsage as incrementUsageApi,
  checkSystemDeps,
} from '@tracepilot/client';
import { toErrorMessage } from '@tracepilot/ui';

export const useLauncherStore = defineStore('launcher', () => {
  const models = ref<ModelInfo[]>([]);
  const templates = ref<SessionTemplate[]>([]);
  const recentLaunches = ref<LaunchedSession[]>([]);
  const systemDeps = ref<SystemDependencies | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isReady = computed(
    () => systemDeps.value?.gitAvailable && systemDeps.value?.copilotAvailable,
  );

  const modelsByTier = computed(() => {
    const tiers: Record<string, ModelInfo[]> = {};
    for (const m of models.value) {
      (tiers[m.tier] ??= []).push(m);
    }
    return tiers;
  });

  async function initialize() {
    loading.value = true;
    error.value = null;
    try {
      const [depsResult, modelsResult, templatesResult] = await Promise.allSettled([
        checkSystemDeps(),
        getAvailableModels(),
        listSessionTemplates(),
      ]);
      if (depsResult.status === 'fulfilled') systemDeps.value = depsResult.value;
      if (modelsResult.status === 'fulfilled') models.value = modelsResult.value;
      if (templatesResult.status === 'fulfilled') templates.value = templatesResult.value;
      const failures = [depsResult, modelsResult, templatesResult]
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => toErrorMessage(r.reason));
      if (failures.length) error.value = failures.join('; ');
    } catch (e) {
      error.value = toErrorMessage(e);
    } finally {
      loading.value = false;
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
    } catch {
      // Non-critical — don't surface errors for usage tracking
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
