<script setup lang="ts">
import { useTodoDependencyGraphContext } from "@/composables/useTodoDependencyGraph";
import { STATUS_ICON } from "./constants";

const ctx = useTodoDependencyGraphContext();
</script>

<template>
  <div v-if="ctx.selectedTodo.value" class="detail-panel">
    <div class="detail-panel-header">
      <div class="detail-panel-title">
        <span
          class="detail-status-icon"
          :style="{ color: ctx.statusColor.value[ctx.selectedTodo.value.status]?.text }"
        >{{ STATUS_ICON[ctx.selectedTodo.value.status] ?? "○" }}</span>
        <span>{{ ctx.selectedTodo.value.title }}</span>
        <span :class="['detail-badge', ctx.selectedTodo.value.status]">
          {{ ctx.selectedTodo.value.status.replace("_", " ") }}
        </span>
      </div>
      <button class="close-detail" @click="ctx.closeDetail" aria-label="Close detail panel"><span aria-hidden="true">✕</span></button>
    </div>
    <div class="detail-panel-body">
      <div class="detail-section">
        <h4>Description</h4>
        <p class="detail-description">
          {{ ctx.selectedTodo.value.description || "No description" }}
        </p>
        <div class="detail-id">
          ID: <code>{{ ctx.selectedTodo.value.id }}</code>
        </div>
      </div>
      <div class="detail-section">
        <h4>Dependencies ({{ ctx.getDependencies(ctx.selectedTodo.value.id).length }})</h4>
        <ul class="dep-list">
          <li v-if="ctx.getDependencies(ctx.selectedTodo.value.id).length === 0" class="dep-empty">
            No dependencies
          </li>
          <li v-for="dep in ctx.getDependencies(ctx.selectedTodo.value.id)" :key="dep.id">
            <span :style="{ color: ctx.statusColor.value[dep.status]?.text }">
              {{ STATUS_ICON[dep.status] ?? "○" }}
            </span>
            {{ dep.title }}
          </li>
        </ul>
      </div>
      <div class="detail-section">
        <h4>Dependents ({{ ctx.getDependents(ctx.selectedTodo.value.id).length }})</h4>
        <ul class="dep-list">
          <li v-if="ctx.getDependents(ctx.selectedTodo.value.id).length === 0" class="dep-empty">
            No dependents
          </li>
          <li v-for="dep in ctx.getDependents(ctx.selectedTodo.value.id)" :key="dep.id">
            <span :style="{ color: ctx.statusColor.value[dep.status]?.text }">
              {{ STATUS_ICON[dep.status] ?? "○" }}
            </span>
            {{ dep.title }}
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
