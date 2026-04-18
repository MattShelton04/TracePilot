<script setup lang="ts">
import { provide } from "vue";
import McpServerDetailActions from "@/components/mcp/McpServerDetailActions.vue";
import McpServerDetailConnection from "@/components/mcp/McpServerDetailConnection.vue";
import McpServerDetailHeader from "@/components/mcp/McpServerDetailHeader.vue";
import McpServerDetailHealth from "@/components/mcp/McpServerDetailHealth.vue";
import McpServerDetailMetadata from "@/components/mcp/McpServerDetailMetadata.vue";
import McpServerDetailTools from "@/components/mcp/McpServerDetailTools.vue";
import {
  McpServerDetailKey,
  useMcpServerDetail,
} from "@/composables/useMcpServerDetail";
import "@/styles/features/mcp-server-detail.css";

const ctx = useMcpServerDetail();
provide(McpServerDetailKey, ctx);
const { server, serverName, store, lastCheckedDisplay, goBack } = ctx;
</script>

<template>
  <div class="mcp-detail-view">
    <!-- Top Bar -->
    <div class="detail-topbar">
      <button class="back-link" @click="goBack">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg>
        Back to MCP Servers
      </button>
      <div class="topbar-spacer" />
      <div class="topbar-actions">
        <span class="text-caption">{{ lastCheckedDisplay }}</span>
      </div>
    </div>

    <!-- Not found -->
    <div v-if="!server && !store.loading" class="not-found">
      <p>The server "{{ serverName }}" was not found.</p>
      <button class="btn-secondary" @click="goBack">Back to MCP Servers</button>
    </div>

    <!-- Split Layout -->
    <div v-if="server" class="split-wrapper">
      <div class="panel-left">
        <McpServerDetailHeader />
        <McpServerDetailConnection />
        <McpServerDetailMetadata />
        <McpServerDetailActions />
      </div>

      <div class="panel-right">
        <McpServerDetailTools />
        <McpServerDetailHealth />
      </div>
    </div>
  </div>
</template>
