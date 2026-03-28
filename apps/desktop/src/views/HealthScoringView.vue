<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import type { HealthScoringData } from '@tracepilot/types';
import { getHealthScores } from '@tracepilot/client';
import { EmptyState, ErrorState, HealthRing, LoadingOverlay, toErrorMessage } from '@tracepilot/ui';

const data = ref<HealthScoringData | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

async function reload() {
  loading.value = true;
  error.value = null;
  data.value = null;
  try {
    data.value = await getHealthScores();
  } catch (e) {
    error.value = toErrorMessage(e, 'Failed to load health scores');
  } finally {
    loading.value = false;
  }
}

onMounted(reload);

const avgScoreDisplay = computed(() => data.value?.overallScore.toFixed(2) ?? '—');
const hasSessions = computed(() => {
  const d = data.value;
  if (!d) return false;
  return d.healthyCount + d.attentionCount + d.criticalCount > 0;
});

function severityBadgeClass(severity: 'warning' | 'danger'): string {
  return severity === 'danger' ? 'badge badge-danger' : 'badge badge-warning';
}

function severityLabel(severity: 'warning' | 'danger'): string {
  return severity === 'danger' ? 'Critical' : 'Warning';
}
</script>

<template>
  <div class="page-content">
    <div class="page-content-inner">
      <!-- Error state -->
      <ErrorState v-if="error" heading="Failed to load health scores" :message="error" @retry="reload" />

      <LoadingOverlay :loading="loading" message="Loading health data…">
      <template v-if="data">
        <EmptyState
          v-if="!hasSessions"
          message="No health data is available yet. Run a few sessions to generate health scores."
        />
        <template v-else>
        <!-- Hero Section: Large Health Ring + Stat Cards -->
        <section class="health-hero" aria-label="Overall health summary">
          <HealthRing :score="data.overallScore" size="lg" />
          <div class="grid-4" style="flex: 1;">
            <div class="stat-card">
              <div class="stat-card-value success">{{ data.healthyCount }}</div>
              <div class="stat-card-label">Healthy</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value warning">{{ data.attentionCount }}</div>
              <div class="stat-card-label">Needs Attention</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value danger">{{ data.criticalCount }}</div>
              <div class="stat-card-label">Critical</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-value warning">{{ avgScoreDisplay }}</div>
              <div class="stat-card-label">Avg Score</div>
            </div>
          </div>
        </section>

        <!-- Attention Grid: Sessions needing attention -->
        <section
          v-if="data.attentionSessions.length"
          aria-label="Sessions needing attention"
          style="margin-bottom: 24px;"
        >
          <div class="grid-3">
            <div
              v-for="session in data.attentionSessions"
              :key="session.sessionId"
              class="attention-card card card-interactive"
            >
              <HealthRing :score="session.score" size="sm" />
              <div style="flex: 1; min-width: 0;">
                <div class="attention-card-name">{{ session.sessionName }}</div>
                <div class="attention-card-flags">
                  {{ session.flags.length }} flag{{ session.flags.length !== 1 ? 's' : '' }} raised
                </div>
                <div class="attention-card-badges">
                  <span
                    v-for="flag in session.flags"
                    :key="flag.name"
                    :class="severityBadgeClass(flag.severity)"
                  >
                    {{ flag.name }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Health Flags Table -->
        <section
          v-if="data.healthFlags.length"
          class="section-panel"
          aria-label="Health flags breakdown"
        >
          <div class="section-panel-header">Health Flags</div>
          <table class="data-table" aria-label="Health flag details">
            <thead>
              <tr>
                <th>Flag</th>
                <th style="text-align: right;">Count</th>
                <th>Severity</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="flag in data.healthFlags" :key="flag.name">
                <td style="font-weight: 600;">{{ flag.name }}</td>
                <td style="text-align: right; font-variant-numeric: tabular-nums;">{{ flag.count }}</td>
                <td><span :class="severityBadgeClass(flag.severity)">{{ severityLabel(flag.severity) }}</span></td>
                <td style="color: var(--text-tertiary);">{{ flag.description }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        </template>
      </template>
      </LoadingOverlay>
    </div>
  </div>
</template>

<style scoped>
.health-hero {
  display: flex;
  align-items: center;
  gap: 32px;
  margin-bottom: 24px;
}

.attention-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
}

.attention-card-name {
  font-size: 0.8125rem;
  font-weight: 600;
}

.attention-card-flags {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.attention-card-badges {
  display: flex;
  gap: 4px;
  margin-top: 6px;
  flex-wrap: wrap;
}
</style>
