import { describe, expect, it } from "vitest";
import router from "@/router";
import { ROUTE_NAMES, isRouteName } from "@/config/routes";
import { SIDEBAR_IDS } from "@/config/sidebarIds";

describe("route registry consistency", () => {
  it("every registered router name is present in ROUTE_NAMES", () => {
    const registered = router
      .getRoutes()
      .map((r) => r.name)
      .filter((n): n is string => typeof n === "string");

    const missing = registered.filter((n) => !isRouteName(n));

    expect(missing, `Route names not in ROUTE_NAMES registry: ${missing.join(", ")}`).toEqual([]);
  });

  it("every ROUTE_NAMES entry resolves to a registered route", () => {
    const registeredNames = new Set(
      router
        .getRoutes()
        .map((r) => r.name)
        .filter((n): n is string => typeof n === "string"),
    );

    const orphaned = Object.values(ROUTE_NAMES).filter((name) => !registeredNames.has(name));

    expect(orphaned, `ROUTE_NAMES entries without a matching route: ${orphaned.join(", ")}`).toEqual(
      [],
    );
  });

  it("every route's sidebarId is present in SIDEBAR_IDS", () => {
    const validSidebarIds = new Set<string>(Object.values(SIDEBAR_IDS));
    const offenders: string[] = [];

    for (const r of router.getRoutes()) {
      const id = r.meta?.sidebarId;
      if (id && !validSidebarIds.has(id)) {
        offenders.push(`${String(r.name)} → "${id}"`);
      }
    }

    expect(offenders, `Routes with unknown sidebarId: ${offenders.join(", ")}`).toEqual([]);
  });
});
