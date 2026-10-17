import type { TurnToolCall } from "@tracepilot/types";
import {
  type ComputedRef,
  computed,
  type InjectionKey,
  inject,
  type MaybeRefOrGetter,
  provide,
  toValue,
} from "vue";
import type { RendererShellStatus } from "../components/RendererShell.vue";
import { toolCallStatus } from "../utils/toolCallStatus";

const SESSION_ENDED_KEY: InjectionKey<ComputedRef<boolean>> = Symbol("SessionEnded");

/**
 * Tells the tool-call tree below whether its session has ended, so a call
 * that never reported a result reads as settled rather than pending. Hosts
 * that cannot tell provide nothing, and calls keep their live behaviour.
 */
export function provideSessionEnded(ended: MaybeRefOrGetter<boolean>): void {
  provide(
    SESSION_ENDED_KEY,
    computed(() => toValue(ended)),
  );
}

/** Whether the provided session has ended; false when no host says so. */
export function useSessionEnded(): ComputedRef<boolean> {
  const ended = inject(SESSION_ENDED_KEY, null);
  return computed(() => ended?.value ?? false);
}

/** {@link toolCallStatus} for a call, aware of whether its session has ended. */
export function useToolCallStatus(
  tc: MaybeRefOrGetter<TurnToolCall | undefined>,
): ComputedRef<RendererShellStatus> {
  const ended = useSessionEnded();
  return computed(() => toolCallStatus(toValue(tc), ended.value));
}
