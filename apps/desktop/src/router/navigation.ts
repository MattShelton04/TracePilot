import type { LocationQueryRaw, NavigationFailure, RouteParamsRaw, Router } from "vue-router";
import { ROUTE_NAMES, type RouteName } from "@/config/routes";

/**
 * Typed `router.push(...)` wrapper keyed by the canonical {@link ROUTE_NAMES}
 * registry.  Centralises named-route navigation so callers don't drift back
 * into stringly-typed `router.push("/foo/bar")` calls.
 *
 * See Phase 4.5 / Wave 47 of `docs/tech-debt-plan-revised-2026-04.md`.
 */
export interface PushRouteOptions {
  params?: RouteParamsRaw;
  query?: LocationQueryRaw;
  hash?: string;
  replace?: boolean;
}

export function pushRoute(
  router: Router,
  name: RouteName,
  options: PushRouteOptions = {},
  // biome-ignore lint/suspicious/noConfusingVoidType: matches Vue Router's `router.push/replace` return type.
): Promise<NavigationFailure | void | undefined> {
  const { params, query, hash, replace } = options;
  const location = {
    name,
    ...(params !== undefined ? { params } : {}),
    ...(query !== undefined ? { query } : {}),
    ...(hash !== undefined ? { hash } : {}),
  };
  return replace ? router.replace(location) : router.push(location);
}

export { ROUTE_NAMES };
