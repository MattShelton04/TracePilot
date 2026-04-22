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

<style scoped src="./wizard-shared.css"></style>

<style scoped>
.features-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  width: 100%;
  margin: 8px 0;
}

.feature-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border-radius: var(--radius-lg, 10px);
  background: var(--canvas-subtle, #111113);
  border: 1px solid var(--border-muted, rgba(255, 255, 255, 0.06));
  text-align: left;
  opacity: 0;
  transform: translateY(12px);
  transition: transform 220ms ease, border-color 220ms ease, box-shadow 220ms ease, background 220ms ease;
  cursor: default;
}

.feature-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-accent, rgba(99, 102, 241, 0.5));
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.10), 0 0 0 1px rgba(99, 102, 241, 0.08);
  background: var(--canvas-raised, #1c1c1f);
}

.feature-card.animate-in {
  animation: fadeInUp 400ms ease forwards;
}

/* After animation completes, set final state directly so hover transform works
   (animation fill-forwards blocks hover transforms per CSS spec) */
.feature-card.animate-done {
  opacity: 1;
  transform: translateY(0);
}

.feature-card.animate-done:hover {
  transform: translateY(-2px);
  border-color: var(--border-accent, rgba(99, 102, 241, 0.5));
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.10), 0 0 0 1px rgba(99, 102, 241, 0.08);
  background: var(--canvas-raised, #1c1c1f);
}

@keyframes fadeInUp {
  to { opacity: 1; transform: translateY(0); }
}

.feature-icon {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.feature-text {
  flex: 1;
  min-width: 0;
}

.feature-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary, #fafafa);
}

.feature-desc {
  font-size: 0.6875rem;
  color: var(--text-tertiary, #71717a);
  margin-top: 2px;
  line-height: 1.4;
}

@media (prefers-reduced-motion: reduce) {
  .feature-card { opacity: 1; transform: none; animation: none !important; }
}
</style>
