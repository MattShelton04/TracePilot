<script setup lang="ts">
import { EmptyState } from "@tracepilot/ui";
import { useRouter } from "vue-router";

const router = useRouter();
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <EmptyState icon="404" title="Page Not Found" message="The page you're looking for doesn't exist.">
        <template #actions>
          <button class="btn btn-primary" @click="router.push('/')">
            Back to Sessions
          </button>
        </template>
      </EmptyState>
    </div>
  </div>
</template>
