<script setup lang="ts">
/**
 * Message log: every exchange in time order with sender, recipients, kind,
 * delivery and text. Selecting a row expands the full message and selects
 * the exchange in the diagram above; selecting in the diagram scrolls the
 * row into view. During graph playback, rows after the playhead are dimmed.
 */
import type { CommsTimeline, CommsTimelineEvent } from "@tracepilot/ui";
import { AgentChip, formatTimelineOffset, MarkdownContent } from "@tracepilot/ui";
import { nextTick, ref, watch } from "vue";
import { edgeLabel } from "./commsVisuals";

const props = defineProps<{
  timeline: CommsTimeline;
  events: CommsTimelineEvent[];
  selectedId: string | null;
  /** Graph playhead; rows after it are dimmed. */
  playheadMs?: number | null;
}>();

const emit = defineEmits<{ select: [id: string | null] }>();

const scroller = ref<HTMLElement | null>(null);

function toggle(id: string) {
  emit("select", props.selectedId === id ? null : id);
}

function deliveryLines(
  ev: CommsTimelineEvent,
): Array<{ text: string; tone?: "queued" | "failed" }> {
  const d = props.timeline.durationMs;
  if (ev.comm.failed) {
    return [{ text: ev.comm.kind === "read" ? "failed" : "not delivered", tone: "failed" }];
  }
  if (ev.comm.kind === "read") return [{ text: ev.poll ? "still running" : "returned" }];
  const waits = ev.deliveries.filter((x) => x.waitMs >= 500 || x.queued);
  if (!waits.length) return [{ text: ev.deliveries.length ? "immediate" : "unconfirmed" }];
  return waits.map((x) => ({
    text: `${ev.toKeys.length > 1 ? `${nameOf(x.toKey)} ` : ""}+${formatTimelineOffset(x.waitMs, d)}${x.queued ? " queued" : ""}`,
    tone: x.queued ? "queued" : undefined,
  }));
}

function nameOf(key: string): string {
  return props.timeline.agents.find((a) => a.key === key)?.name ?? key;
}

// Keep the selected row visible without scrolling the page itself.
watch(
  () => props.selectedId,
  async (id) => {
    if (!id) return;
    await nextTick();
    const box = scroller.value;
    const rows = box?.querySelectorAll<HTMLElement>("[data-comm-id]") ?? [];
    const row = [...rows].find((el) => el.dataset.commId === id);
    if (!box || !row) return;
    const boxRect = box.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const header = box.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    if (rowRect.top >= boxRect.top + header && rowRect.bottom <= boxRect.bottom) return;
    const top = rowRect.top - boxRect.top + box.scrollTop - box.clientHeight / 3;
    box.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  },
);
</script>

<template>
  <section class="comms-log" aria-label="Message log">
    <div ref="scroller" class="comms-log-scroll">
      <table class="comms-log-table">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Kind</th>
            <th scope="col">Delivery</th>
            <th scope="col">Message</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="ev in events"
            :key="ev.id"
            :data-comm-id="ev.id"
            :class="[
              'comms-log-row',
              `edge--${ev.edge}`,
              {
                'comms-log-row--selected': selectedId === ev.id,
                'comms-log-row--future': playheadMs != null && ev.atMs > playheadMs,
              },
            ]"
            tabindex="0"
            :aria-selected="selectedId === ev.id"
            @click="toggle(ev.id)"
            @keydown.enter.prevent="toggle(ev.id)"
            @keydown.space.prevent="toggle(ev.id)"
          >
            <td class="comms-log-time">{{ formatTimelineOffset(ev.atMs, timeline.durationMs) }}</td>
            <td><AgentChip :identifier="ev.fromKey" size="sm" /></td>
            <td>
              <span v-if="ev.comm.scope" class="comms-scope">all {{ ev.comm.scope }}</span>
              <span v-else class="comms-log-agents">
                <AgentChip v-for="to in ev.toKeys" :key="to" :identifier="to" size="sm" />
              </span>
            </td>
            <td><span class="comms-kind">{{ edgeLabel(ev) }}</span></td>
            <td class="comms-log-delivery">
              <div v-for="(line, i) in deliveryLines(ev)" :key="i" :class="line.tone">{{ line.text }}</div>
            </td>
            <td class="comms-log-message">
              <MarkdownContent
                v-if="selectedId === ev.id && ev.comm.content"
                class="comms-log-full"
                :content="ev.comm.content"
              />
              <span v-else class="comms-log-preview">{{ ev.comm.content || "(no text)" }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!events.length" class="comms-empty">No exchanges match these filters.</p>
    </div>
  </section>
</template>
