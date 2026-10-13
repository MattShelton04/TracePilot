import { describe, expect, it } from "vitest";
import { IPC_COMMANDS } from "../commands.js";
import { MOCK_ROUTE_TABLES, mockRoute } from "../mock/routes/index.js";

describe("mock route tables", () => {
  it("answer each command from one table only", () => {
    const owners = new Map<string, string[]>();
    for (const [table, routes] of Object.entries(MOCK_ROUTE_TABLES))
      for (const cmd of Object.keys(routes)) owners.set(cmd, [...(owners.get(cmd) ?? []), table]);
    const shared = [...owners].filter(([, tables]) => tables.length > 1);
    expect(shared).toEqual([]);
  });

  it("only route registered commands", () => {
    const known = new Set<string>(IPC_COMMANDS);
    const routed = Object.values(MOCK_ROUTE_TABLES).flatMap((routes) => Object.keys(routes));
    expect(routed.filter((cmd) => !known.has(cmd))).toEqual([]);
  });

  it("rejects an unknown command", () => {
    expect(() => mockRoute("no_such_command")).toThrow("[STUB] No mock data for command");
    expect(() => mockRoute("constructor")).toThrow("[STUB]");
  });
});
