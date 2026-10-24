/**
 * Turn and event times in the Conversation tab. A session that runs past
 * midnight, or is resumed another day, dates every time in every view mode,
 * so clock times alone never look like they run backwards. The decision is
 * made once per session, from its turns, and shared with the rows below.
 */
import type { ConversationTurn } from "@tracepilot/types";
import {
  type ComputedRef,
  computed,
  type InjectionKey,
  inject,
  type MaybeRefOrGetter,
  provide,
  toValue,
} from "vue";
import { eventTimeLabel, timestampsSpanDays } from "@/utils/sessionOverview";

const SPANS_DAYS: InjectionKey<ComputedRef<boolean>> = Symbol("conversationSpansDays");

/** Every timestamp a list of turns shows: turn starts and their session events. */
export function conversationTimestamps(turns: readonly ConversationTurn[]): (string | undefined)[] {
  const times: (string | undefined)[] = [];
  for (const turn of turns) {
    times.push(turn.timestamp);
    for (const event of turn.sessionEvents ?? []) times.push(event.timestamp);
  }
  return times;
}

/** Decides whether the conversation's times need dates and shares it below. */
export function provideConversationDates(
  turns: MaybeRefOrGetter<readonly ConversationTurn[]>,
): ComputedRef<boolean> {
  const spansDays = computed(() => timestampsSpanDays(conversationTimestamps(toValue(turns))));
  provide(SPANS_DAYS, spansDays);
  return spansDays;
}

/**
 * A time's label in the conversation: `HH:MM:SS`, after its date when the
 * session spans days, with the full date and time as its tooltip. Without a
 * provider (a row shown on its own) it never adds the date.
 */
export function useConversationTime(): (iso: string | null | undefined) => {
  text: string;
  title?: string;
} {
  const spansDays = inject(SPANS_DAYS, null);
  return (iso) => eventTimeLabel(iso, spansDays?.value ?? false);
}
