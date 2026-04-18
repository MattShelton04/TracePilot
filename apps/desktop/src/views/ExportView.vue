<script setup lang="ts">
import { PageShell, TabNav } from "@tracepilot/ui";
import { ref } from "vue";
import ExportTab from "@/components/export/ExportTab.vue";
import ImportTab from "@/components/export/ImportTab.vue";
import "@/styles/features/export.css";

// ── Tab State ────────────────────────────────────────────────

type TabId = "export" | "import";
const activeTab = ref<TabId>("export");

const exportTabNavItems = [
  { name: "export", routeName: "export", label: "Export" },
  { name: "import", routeName: "import", label: "Import" },
];
</script>

<template>
  <PageShell>
    <div class="export-feature">
      <!-- ── Header + Tabs ── -->
      <header class="export-header">
        <div class="header-row">
          <h1>Export & Import</h1>
          <TabNav
            :tabs="exportTabNavItems"
            :model-value="activeTab"
            variant="pill"
            class="export-tab-nav"
            @update:model-value="(v) => (activeTab = v as TabId)"
          />
        </div>
        <p class="text-secondary">
          {{ activeTab === 'export'
            ? 'Configure and preview your session export'
            : 'Import sessions from a TracePilot archive' }}
        </p>
      </header>

      <ExportTab v-if="activeTab === 'export'" />
      <ImportTab v-if="activeTab === 'import'" />
    </div>
  </PageShell>
</template>
