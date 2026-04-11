<script setup lang="ts">
import { EmptyState, PageShell } from "@tracepilot/ui";
import { useRouter } from "vue-router";

const router = useRouter();
</script>

<template>
  <PageShell>
    <EmptyState icon="404" title="Page Not Found" message="The page you're looking for doesn't exist.">
      <template #actions>
        <button class="btn btn-primary" @click="router.push('/')">
          Back to Sessions
        </button>
      </template>
    </EmptyState>
  </PageShell>
</template>
