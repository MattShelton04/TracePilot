import type { InjectionKey } from "vue";
import { inject } from "vue";

export type ExternalLinkHandler = (url: string) => void | Promise<void>;

export const EXTERNAL_LINK_HANDLER_KEY: InjectionKey<ExternalLinkHandler> = Symbol(
  "tracepilot-external-link-handler",
);

export function useExternalLinkHandler(): ExternalLinkHandler | null {
  return inject(EXTERNAL_LINK_HANDLER_KEY, null);
}
