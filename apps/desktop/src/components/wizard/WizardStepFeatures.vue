<script setup lang="ts">
import { ref } from "vue";
import { getChartColors } from "@/utils/designTokens";

defineProps<{
  active: boolean;
}>();

const emit = defineEmits<{
  next: [];
}>();

const animatedCards = ref(new Set<number>());

// Load colors from design tokens
const chartColors = getChartColors();

const features = [
  {
    emoji: "📋",
    color: chartColors.primaryLight, // indigo
    title: "Session Explorer",
    desc: "Browse and search all your Copilot coding sessions",
  },
  {
    emoji: "💬",
    color: chartColors.success, // emerald
    title: "Conversation Viewer",
    desc: "Replay full AI conversations turn by turn",
  },
  {
    emoji: "📊",
    color: chartColors.warning, // amber
    title: "Analytics Dashboard",
    desc: "Track token usage, costs, and productivity trends",
  },
  {
    emoji: "🔧",
    color: "#f472b6", // pink - not in chart colors, keep as-is for now
    title: "Tool Analysis",
    desc: "See which tools Copilot uses and how effectively",
  },
  {
    emoji: "📝",
    color: chartColors.secondary, // violet
    title: "Code Impact",
    desc: "Measure lines changed, files modified, and net impact",
  },
  {
    emoji: "💰",
    color: chartColors.orange, // orange
    title: "Cost Tracking",
    desc: "Monitor premium request spending and API cost estimates",
  },
];
</script>

<template>
  <div class="slide">
    <div class="slide-content slide-features">
      <h2 class="slide-title" tabindex="-1">Powerful Analytics at Your Fingertips</h2>
      <div class="features-grid">
        <div
          v-for="(f, i) in features"
          :key="f.title"
          class="feature-card"
          :style="{ animationDelay: active ? `${i * 80}ms` : '0ms' }"
          :class="{
            'animate-in': active && !animatedCards.has(i),
            'animate-done': animatedCards.has(i),
          }"
          @animationend="animatedCards.add(i)"
        >
          <div class="feature-icon" :style="{ background: f.color + '20', color: f.color }">
            {{ f.emoji }}
          </div>
          <div class="feature-text">
            <div class="feature-title">{{ f.title }}</div>
            <div class="feature-desc">{{ f.desc }}</div>
          </div>
        </div>
      </div>
      <button class="btn-accent" @click="emit('next')">Continue →</button>
    </div>
  </div>
</template>
