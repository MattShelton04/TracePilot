/**
 * The Overview tab's shared, derived session state.
 *
 * {@link OverviewTab} creates it once and provides it; each section in
 * `overviewSections.ts` reads it with {@link useOverviewModel}. State only one
 * section uses stays in that section's component.
 */
import type { SessionDetail, ShutdownMetrics } from "@tracepilot/types";
import { type ComputedRef, computed, type InjectionKey, inject, type Ref, ref } from "vue";
import type {
  OutcomeStatus,
  OverviewSection,
  SectionStatus,
} from "@/components/overview/SessionOutcomeTiles.vue";
import type { SessionDetailContext } from "@/composables/useSessionDetail";
import { type SessionLiveState, useSessionLiveState } from "@/composables/useSessionLiveState";
import { useSessionSource } from "@/composables/useSessionSource";

export function parseTime(value: string | null | undefined): number | null {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(ms) ? null : ms;
}

// A running session that has been waiting for hours did not last until
// now: only recent activity counts as ongoing in the duration and timeline.
const ACTIVE_WITHIN_MS = 10 * 60_000;

const SECTION_ERRORS = {
  metrics: (store: SessionDetailContext) => store.metricsError,
  incidents: (store: SessionDetailContext) => store.incidentsError,
  plan: (store: SessionDetailContext) => store.planError,
  checkpoints: (store: SessionDetailContext) => store.checkpointsError,
  fileHistory: (store: SessionDetailContext) => store.fileHistoryError,
} as const;
type OverviewDataSection = keyof typeof SECTION_ERRORS;

/** Must be called from the Overview tab's setup (it injects the live state). */
export function createOverviewModel(store: SessionDetailContext) {
  const detail = computed<SessionDetail | null>(() => store.detail);
  const metrics = computed<ShutdownMetrics | null>(() => store.shutdownMetrics);
  // An empty change record (no lines, no files) reads as "none recorded".
  const codeChanges = computed(() => {
    const changes = metrics.value?.codeChanges;
    if (!changes) return undefined;
    const lines = (changes.linesAdded ?? 0) + (changes.linesRemoved ?? 0);
    return lines > 0 || changes.filesModified?.length ? changes : undefined;
  });
  const incidents = computed(() => store.incidents);
  const live: ComputedRef<SessionLiveState> = useSessionLiveState();
  const { source, capabilities } = useSessionSource(
    () => store.sessionId,
    () => store.detail,
  );
  const isClaude = computed(() => source.value === "claudeCode");

  const activeNow = computed(() => {
    if (!live.value.running) return false;
    const updated = parseTime(detail.value?.updatedAt);
    return updated != null && Date.now() - updated < ACTIVE_WITHIN_MS;
  });

  const spanMs = computed(() => {
    const start = parseTime(detail.value?.createdAt);
    const end = parseTime(detail.value?.updatedAt);
    return start != null && end != null && end > start ? end - start : null;
  });
  const turnCount = computed(() => detail.value?.turnCount ?? 0);
  const segments = computed(() => metrics.value?.sessionSegments ?? []);
  const activityLoaded = computed(() => store.loaded.has("activity"));

  /** Error beats pending; a section is `ready` only once every load completed. */
  function sectionStatus(keys: OverviewDataSection[]): SectionStatus {
    if (keys.some((key) => SECTION_ERRORS[key](store))) return "error";
    return keys.every((key) => store.loaded.has(key)) ? "ready" : "pending";
  }

  const outcomeStatus = computed<OutcomeStatus>(() => {
    const fileHistory: OverviewDataSection[] = capabilities.value.hasFileHistory
      ? ["fileHistory"]
      : [];
    const checkpoints: OverviewDataSection[] = capabilities.value.hasCheckpoints
      ? ["checkpoints"]
      : [];
    return {
      // Metrics that are present were loaded, even if a later refresh failed.
      metrics: metrics.value ? "ready" : sectionStatus(["metrics"]),
      incidents: sectionStatus(["incidents"]),
      changes: codeChanges.value ? "ready" : sectionStatus(["metrics", ...fileHistory]),
      saved: sectionStatus(["plan", ...checkpoints, ...fileHistory]),
    };
  });

  // Sections register the element a jump to them scrolls to.
  const anchors = new Map<OverviewSection, Ref<HTMLElement | null>>();
  function anchor(section: OverviewSection): Ref<HTMLElement | null> {
    const el = ref<HTMLElement | null>(null);
    anchors.set(section, el);
    return el;
  }

  function scrollToSection(section: OverviewSection) {
    const target = anchors.get(section)?.value;
    if (!target) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  return {
    store,
    detail,
    metrics,
    codeChanges,
    incidents,
    live,
    source,
    capabilities,
    isClaude,
    activeNow,
    spanMs,
    turnCount,
    segments,
    activityLoaded,
    outcomeStatus,
    anchor,
    scrollToSection,
  };
}

export type OverviewModel = ReturnType<typeof createOverviewModel>;

export const OVERVIEW_MODEL_KEY: InjectionKey<OverviewModel> = Symbol("overviewModel");

export function useOverviewModel(): OverviewModel {
  const model = inject(OVERVIEW_MODEL_KEY, null);
  if (!model) throw new Error("Overview sections must render inside OverviewTab");
  return model;
}
