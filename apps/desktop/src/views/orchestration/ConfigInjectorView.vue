<script setup lang="ts">
import {
  ErrorAlert,
  LoadingSpinner,
  PageHeader,
  TabNav,
  useDismissable,
} from "@tracepilot/ui";
import { computed, provide } from "vue";
import ConfigInjectorAgentsTab from "@/components/configInjector/ConfigInjectorAgentsTab.vue";
import ConfigInjectorBackupsTab from "@/components/configInjector/ConfigInjectorBackupsTab.vue";
import ConfigInjectorGlobalTab from "@/components/configInjector/ConfigInjectorGlobalTab.vue";
import ConfigInjectorVersionsTab from "@/components/configInjector/ConfigInjectorVersionsTab.vue";
import { ConfigInjectorKey, useConfigInjector } from "@/composables/useConfigInjector";
import { type ConfigTab } from "@/stores/configInjector";
import "@/styles/features/config-injector.css";

const ctx = useConfigInjector();
provide(ConfigInjectorKey, ctx);
const { store } = ctx;

const { isDismissed: warningDismissed, dismiss: dismissWarning } =
  useDismissable("config-injector-warning");

const tabs: { key: ConfigTab; label: string; emoji: string }[] = [
  { key: "agents", label: "Agent Models", emoji: "🤖" },
  { key: "global", label: "Global Config", emoji: "📋" },
  { key: "versions", label: "Environment", emoji: "🔧" },
  { key: "backups", label: "Backups", emoji: "💾" },
];

function tabCount(key: ConfigTab): number | null {
  if (key === "agents") return store.agents.length;
  if (key === "backups") return store.backups.length;
  return null;
}

const tabNavItems = computed(() =>
  tabs.map((t) => {
    const count = tabCount(t.key);
    return {
      name: t.key,
      routeName: t.key,
      label: t.label,
      icon: t.emoji,
      ...(count !== null ? { count } : {}),
    };
  }),
);
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <ErrorAlert
        v-if="store.error"
        :message="store.error"
        variant="banner"
        dismissible
        @dismiss="store.error = null"
      />

      <nav class="breadcrumb">
        <span class="breadcrumb-link">Orchestration</span>
        <span class="breadcrumb-sep">›</span>
        <span class="breadcrumb-current">Config Injector</span>
      </nav>

      <PageHeader title="⚙️ Config Injector" size="sm" class="config-injector-header" />

      <Transition name="banner">
        <div v-if="store.hasCustomizations && !warningDismissed" class="warning-banner">
          <span class="warning-banner-text">
            ⚠️ Copilot will overwrite customizations on update. Set
            <code>COPILOT_AUTO_UPDATE=false</code> to prevent.
            We don't recommend disabling auto-update and suggest reinjecting after every update.
          </span>
          <button class="warning-banner-close" title="Dismiss" @click="dismissWarning()">✕</button>
        </div>
      </Transition>

      <TabNav
        :tabs="tabNavItems"
        :model-value="store.activeTab"
        staggered
        class="config-injector-tabs"
        @update:model-value="(v) => (store.activeTab = v as ConfigTab)"
      />

      <div v-if="store.loading" class="loading-state">
        <LoadingSpinner size="lg" />
        <span>Loading configuration…</span>
      </div>

      <ConfigInjectorAgentsTab v-if="!store.loading && store.activeTab === 'agents'" />
      <ConfigInjectorGlobalTab v-else-if="!store.loading && store.activeTab === 'global'" />
      <ConfigInjectorVersionsTab v-else-if="!store.loading && store.activeTab === 'versions'" />
      <ConfigInjectorBackupsTab v-else-if="!store.loading && store.activeTab === 'backups'" />
    </div>
  </div>
</template>
