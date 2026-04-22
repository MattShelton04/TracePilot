import { describe, expect, it, vi } from "vitest";
import type { Router } from "vue-router";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";

function makeRouter() {
  const push = vi.fn().mockResolvedValue(undefined);
  const replace = vi.fn().mockResolvedValue(undefined);
  return { push, replace } as unknown as Router & { push: typeof push; replace: typeof replace };
}

describe("pushRoute", () => {
  it("delegates to router.push with the named location", () => {
    const router = makeRouter();
    pushRoute(router, ROUTE_NAMES.sessions);
    expect(router.push).toHaveBeenCalledWith({ name: ROUTE_NAMES.sessions });
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("forwards params, query, and hash", () => {
    const router = makeRouter();
    pushRoute(router, ROUTE_NAMES.sessionOverview, {
      params: { id: "abc" },
      query: { foo: "1" },
      hash: "#top",
    });
    expect(router.push).toHaveBeenCalledWith({
      name: ROUTE_NAMES.sessionOverview,
      params: { id: "abc" },
      query: { foo: "1" },
      hash: "#top",
    });
  });

  it("uses router.replace when replace: true is passed", () => {
    const router = makeRouter();
    pushRoute(router, ROUTE_NAMES.mcpServerDetail, {
      params: { name: "srv" },
      replace: true,
    });
    expect(router.replace).toHaveBeenCalledWith({
      name: ROUTE_NAMES.mcpServerDetail,
      params: { name: "srv" },
    });
    expect(router.push).not.toHaveBeenCalled();
  });

  it("omits undefined option keys from the location", () => {
    const router = makeRouter();
    pushRoute(router, ROUTE_NAMES.sessions, {});
    expect(router.push).toHaveBeenCalledWith({ name: ROUTE_NAMES.sessions });
  });
});
