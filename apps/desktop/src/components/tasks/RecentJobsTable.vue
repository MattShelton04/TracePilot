<script setup lang="ts">
import type { Job } from "@tracepilot/types";
import { formatDate } from "@tracepilot/ui";

defineProps<{
  jobs: Job[];
}>();

function statusColor(status: string) {
  switch (status) {
    case "running":
      return "var(--accent-fg)";
    case "completed":
      return "var(--success-fg)";
    case "failed":
      return "var(--danger-fg)";
    case "cancelled":
      return "var(--text-tertiary)";
    default:
      return "var(--text-secondary)";
  }
}

function progressPct(job: { tasksCompleted: number; taskCount: number }) {
  if (job.taskCount === 0) return 0;
  return Math.round((job.tasksCompleted / job.taskCount) * 100);
}

function progressClass(status: string) {
  switch (status) {
    case "completed":
      return "job-progress-success";
    case "failed":
      return "job-progress-danger";
    case "running":
      return "job-progress-accent";
    default:
      return "job-progress-neutral";
  }
}
</script>

<template>
  <div class="jobs-section">
    <h2 class="jobs-section__title">Recent Jobs</h2>
    <div class="jobs-table-wrap">
      <table class="jobs-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="job in jobs" :key="job.id">
            <td class="jobs-table__name">{{ job.name }}</td>
            <td>
              <span class="job-status-badge-wrap">
                <span
                  class="job-status-dot"
                  :style="{ background: statusColor(job.status) }"
                />
                <span
                  class="job-status-badge"
                  :style="{ color: statusColor(job.status) }"
                >
                  {{ job.status }}
                </span>
              </span>
            </td>
            <td class="jobs-table__progress">
              <div class="job-progress-bar-wrap">
                <div class="job-progress-bar">
                  <div
                    class="job-progress-fill"
                    :class="progressClass(job.status)"
                    :style="{
                      width: `${progressPct(job)}%`,
                    }"
                  />
                </div>
                <span class="job-progress-pct">{{ progressPct(job) }}%</span>
              </div>
              <span class="jobs-table__counts">
                {{ job.tasksCompleted }}/{{ job.taskCount }} done
              </span>
              <span v-if="job.tasksFailed > 0" class="jobs-table__failed">
                · {{ job.tasksFailed }} failed
              </span>
            </td>
            <td class="jobs-table__date">
              {{ formatDate(job.createdAt) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.jobs-section {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--border-default);
}

.jobs-section__title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 14px;
  letter-spacing: -0.01em;
}

.jobs-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--canvas-subtle);
}

.jobs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.jobs-table th {
  text-align: left;
  padding: 10px 14px;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-default);
  white-space: nowrap;
}

.jobs-table td {
  padding: 10px 14px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-muted);
  vertical-align: middle;
}

.jobs-table tbody tr:last-child td {
  border-bottom: none;
}

.jobs-table tbody tr:hover {
  background: var(--neutral-subtle);
}

.jobs-table__name {
  color: var(--text-primary);
  font-weight: 500;
}

.job-status-badge {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: capitalize;
}

.jobs-table__progress {
  font-variant-numeric: tabular-nums;
}

.jobs-table__counts {
  color: var(--text-secondary);
}

.jobs-table__failed {
  color: var(--danger-fg);
  font-weight: 500;
}

.jobs-table__date {
  color: var(--text-tertiary);
  white-space: nowrap;
}

.job-status-badge-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.job-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.job-progress-bar-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.job-progress-bar {
  flex: 1;
  height: 3px;
  background: var(--border-default);
  border-radius: 999px;
  overflow: hidden;
  min-width: 60px;
}

.job-progress-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.6s ease;
}

.job-progress-pct {
  font-size: 0.625rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  min-width: 28px;
  text-align: right;
}

.job-progress-success {
  background: var(--success-fg);
}
.job-progress-danger {
  background: var(--danger-fg);
}
.job-progress-accent {
  background: var(--accent-fg);
}
.job-progress-neutral {
  background: var(--text-tertiary);
}
</style>
