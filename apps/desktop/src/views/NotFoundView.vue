<script setup lang="ts">
import { EmptyState, PageShell } from "@tracepilot/ui";
import { useRouter } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";

const router = useRouter();
</script>

<template>
  <PageShell>
    <EmptyState icon="404" title="Page Not Found" message="The page you're looking for doesn't exist.">
      <template #actions>
        <button class="btn btn-primary" @click="pushRoute(router, ROUTE_NAMES.sessions)">
          Back to Sessions
        </button>
      </template>
    </EmptyState>
  </PageShell>
</template>
