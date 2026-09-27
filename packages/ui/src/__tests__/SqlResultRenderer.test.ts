import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SqlResultRenderer from "../components/renderers/SqlResultRenderer.vue";
import { parseSqlResult } from "../utils/sqlResult";

describe("SQL result contracts", () => {
  it("unions columns without conflating missing, null, empty, or nested values", () => {
    const table = parseSqlResult(
      '[{"id":1,"label":"","optional":null},{"id":2,"late":true,"nested":{"items":[1,2]}}]',
    );
    expect(table?.headers).toEqual(["id", "label", "optional", "late", "nested"]);
    expect(table?.rows[0].map((cell) => cell.kind)).toEqual([
      "number",
      "empty",
      "null",
      "missing",
      "missing",
    ]);
    expect(table?.rows[1][4]).toEqual({ kind: "json", text: '{"items":[1,2]}' });
    const wrapper = mount(SqlResultRenderer, {
      props: { content: '[{"id":1},{"id":2,"late":true}]', args: {} },
    });
    expect(wrapper.findAll("th").map((header) => header.text())).toEqual(["id", "late"]);
    expect(wrapper.get("th").classes()).toContain("sql-column--number");
    expect(wrapper.get(".sql-cell--missing").attributes("title")).toBe(
      "Field not present in this row",
    );
  });

  it("handles empty, primitive, ragged array and mixed rows without losing values", () => {
    expect(parseSqlResult("[]")).toEqual({ headers: [], rows: [] });
    expect(parseSqlResult('[null,2,false,""]')?.rows.map((row) => row[0].kind)).toEqual([
      "null",
      "number",
      "boolean",
      "empty",
    ]);
    expect(parseSqlResult("[[1,2],[3]]")?.rows[1][1].kind).toBe("missing");
    expect(parseSqlResult('[{"a":1},"scalar"]')?.rows[1][1].text).toBe("scalar");
    const wrapper = mount(SqlResultRenderer, { props: { content: "[]", args: {} } });
    expect(wrapper.text()).toContain("0 rows");
    expect(wrapper.text()).toContain("No rows returned.");
  });

  it("preserves escaped pipes, code spans, large integer text and surrounding prose", () => {
    const table = parseSqlResult(
      "Query finished\r\n| key | amount |\r\n| --- | ---: |\r\n| a\\|b | 9007199254740993 |\r\n| `x|y` | 2 |\r\n2 rows affected.",
    );
    expect(table?.rows[0][0].text).toBe("a|b");
    expect(table?.rows[0][1]).toEqual({ kind: "number", text: "9007199254740993" });
    expect(table?.rows[1][0].text).toBe("`x|y`");
    expect(table?.before).toBe("Query finished");
    expect(table?.after).toBe("2 rows affected.");
    expect(parseSqlResult("| key |\n| --- |\n")?.rows).toEqual([]);
    expect(parseSqlResult("| key |\n| --- |\n| one | excess |")?.after).toBe("| one | excess |");
  });

  it("retains envelope metadata and supports complete NDJSON and embedded nested arrays", () => {
    const envelope = parseSqlResult('{"rows":[{"id":1}],"notice":"limited","count":1}');
    expect(envelope?.after).toContain('"notice": "limited"');
    expect(parseSqlResult('{"__proto__":"safe"}\n{"constructor":3}')?.headers).toEqual([
      "__proto__",
      "constructor",
    ]);
    const embedded = parseSqlResult('Rows:\n[{"items":[{"label":"]"}]}]\nDone');
    expect(embedded?.rows[0][0].text).toBe('[{"label":"]"}]');
    expect(embedded?.before).toBe("Rows:");
    expect(embedded?.after).toBe("Done");
    expect(parseSqlResult('{"status":"updated","count":2}')).toBeNull();
  });

  it("pages without overlap and retains the raw complete response", async () => {
    const content = JSON.stringify(
      Array.from({ length: 401 }, (_, id) => ({ id, value: `row-${id}` })),
    );
    const wrapper = mount(SqlResultRenderer, {
      props: {
        content,
        args: {},
        tc: { toolName: "sql", toolCallId: "a", success: true, isComplete: true },
      },
    });
    expect(wrapper.findAll("tbody tr")).toHaveLength(200);
    expect(wrapper.get("tbody tr").text()).toContain("row-0");
    await wrapper.get(".sql-pagination button:last-child").trigger("click");
    expect(wrapper.get("tbody tr").text()).toContain("row-200");
    await wrapper.get(".sql-pagination button:last-child").trigger("click");
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.get("tbody tr").text()).toContain("row-400");
    expect(wrapper.get(".recorded-tool-response pre").text()).toBe(content);
    await wrapper.setProps({
      tc: { toolName: "sql", toolCallId: "b", success: true, isComplete: true },
    });
    expect(wrapper.get("tbody tr").text()).toContain("row-0");
  });

  it("renders unknown output and truthful empty lifecycle states", async () => {
    const wrapper = mount(SqlResultRenderer, {
      props: {
        content: "",
        args: { query: "SELECT '<script>'" },
        tc: { toolName: "sql", isComplete: false },
      },
    });
    expect(wrapper.classes()).toContain("rs--pending");
    expect(wrapper.text()).toContain("Waiting for query results");
    expect(wrapper.find("script").exists()).toBe(false);
    await wrapper.setProps({
      content: "Permission denied",
      tc: { toolName: "sql", success: false, isComplete: true },
    });
    expect(wrapper.classes()).toContain("rs--error");
    expect(wrapper.get(".sql-plain-output").text()).toBe("Permission denied");
  });
});
