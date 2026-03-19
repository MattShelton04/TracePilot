import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { SystemDependencies } from '@tracepilot/types';
import { checkSystemDeps, listSessions } from '@tracepilot/client';

export const useOrchestrationHomeStore = defineStore('orchestrationHome', () => {
  const systemDeps = ref<SystemDependencies | null>(null);
  const totalSessions = ref(0);
  const activeSessions = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isHealthy = computed(() => {
    if (!systemDeps.value) return false;
    return systemDeps.value.gitAvailable && systemDeps.value.copilotAvailable;
  });

  async function initialize() {
    loading.value = true;
    error.value = null;
    try {
      const [deps, sessions] = await Promise.all([
        checkSystemDeps(),
        listSessions(),
      ]);
      systemDeps.value = deps;
      totalSessions.value = sessions.length;
      activeSessions.value = sessions.filter((s) => s.isRunning).length;
    } catch (e) {
      error.value = String(e);
    } finally {
      loading.value = false;
    }
  }

  return {
    systemDeps,
    totalSessions,
    activeSessions,
    loading,
    error,
    isHealthy,
    initialize,
  };
});
