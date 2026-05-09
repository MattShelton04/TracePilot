import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DataGrid from "../components/DataGrid.vue";

interface Row {
  id: string;
  name: string;
  count: number;
}

const ROWS: Row[] = [
  { id: "a", name: "Alpha", count: 3 },
  { id: "b", name: "Bravo", count: 1 },
  { id: "c", name: "Charlie", count: 2 },
];

const COLUMNS = [
  { id: "name", label: "Name", accessor: "name", sortable: true },
  { id: "count", label: "Count", accessor: "count", numeric: true, sortable: true },
];

// Wrapper to allow generic component usage with explicit props.
function mountGrid(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  return mount(DataGrid as never, {
    props: { rows: ROWS, columns: COLUMNS, ...props } as never,
    slots,
  });
}

describe("DataGrid", () => {
  it("renders rows and columns", () => {
    const w = mountGrid();
    expect(w.attributes("data-tp-component")).toBe("DataGrid");
    expect(w.findAll("thead th").length).toBe(2);
    expect(w.findAll("tbody tr.dg__row").length).toBe(3);
    expect(w.text()).toContain("Alpha");
    expect(w.text()).toContain("Charlie");
  });

  it("applies density class and switches via toolbar density toggle", async () => {
    const w = mountGrid({}, { toolbar: "<span>chips</span>" });
    expect(w.find(".dg").classes()).toContain("dg--comfortable");
    await w.find('[aria-label="Compact density"]').trigger("click");
    expect(w.find(".dg").classes()).toContain("dg--compact");
  });

  it("sorts asc → desc → none when clicking a sortable header", async () => {
    const w = mountGrid();
    const nameHeader = w.findAll("thead th")[0];
    expect(nameHeader.attributes("aria-sort")).toBe("none");
    await nameHeader.trigger("click");
    expect(nameHeader.attributes("aria-sort")).toBe("ascending");
    let cells = w.findAll("tbody tr.dg__row td:first-child").map((t) => t.text());
    expect(cells).toEqual(["Alpha", "Bravo", "Charlie"]);
    await nameHeader.trigger("click");
    expect(nameHeader.attributes("aria-sort")).toBe("descending");
    cells = w.findAll("tbody tr.dg__row td:first-child").map((t) => t.text());
    expect(cells).toEqual(["Charlie", "Bravo", "Alpha"]);
    await nameHeader.trigger("click");
    expect(nameHeader.attributes("aria-sort")).toBe("none");
  });

  it("sorts numeric columns numerically", async () => {
    const w = mountGrid();
    const countHeader = w.findAll("thead th")[1];
    await countHeader.trigger("click");
    const cells = w.findAll("tbody tr.dg__row td:nth-child(2)").map((t) => t.text());
    expect(cells).toEqual(["1", "2", "3"]);
  });

  it("emits row-activate on click and on Enter", async () => {
    const w = mountGrid();
    await w.find("tbody tr.dg__row").trigger("click");
    expect(w.emitted("row-activate")).toBeTruthy();
    await w.find(".dg__scroll").trigger("keydown", { key: "Enter" });
    const events = w.emitted("row-activate")!;
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it("supports j/k vim row navigation", async () => {
    const w = mountGrid();
    const scroll = w.find(".dg__scroll");
    await scroll.trigger("keydown", { key: "j" });
    await scroll.trigger("keydown", { key: "j" });
    await scroll.trigger("keydown", { key: "k" });
    // focus should land on row index 1 — verify by inspecting tabindex
    const rows = w.findAll("tbody tr.dg__row");
    expect(rows[1].attributes("tabindex")).toBe("0");
  });

  it("renders empty state via EmptyState when rows=[]", () => {
    const w = mountGrid({ rows: [] });
    expect(w.find('[data-tp-component="EmptyState"]').exists()).toBe(true);
  });

  it("renders skeleton rows when state=loading", () => {
    const w = mountGrid({ state: "loading", skeletonRowCount: 3 });
    expect(w.findAll(".dg__row--skeleton").length).toBe(3);
  });

  it("renders error state with retry", async () => {
    const w = mountGrid({ state: "error", errorMessage: "boom" });
    expect(w.text()).toContain("boom");
    await w.find(".dg__retry").trigger("click");
    expect(w.emitted("retry")).toBeTruthy();
  });

  it("supports cell named slot to override rendering", () => {
    const w = mountGrid({}, { "cell-name": '<strong class="cs">{{ "x" }}</strong>' });
    // Vue-test-utils slot strings render literally; just ensure the slot got rendered
    expect(w.html()).toContain("cs");
  });

  it("toggles selection in multi mode via Space", async () => {
    const w = mountGrid({ selectionMode: "multi" });
    const scroll = w.find(".dg__scroll");
    await scroll.trigger("keydown", { key: "j" });
    await scroll.trigger("keydown", { key: " " });
    const events = w.emitted("selection-change");
    expect(events).toBeTruthy();
    expect((events![0][0] as Set<string | number>).has("b")).toBe(true);
  });

  it("pinned rows appear at top regardless of sort", async () => {
    const w = mountGrid({ pinnedRowIds: new Set(["c"]) });
    let cells = w.findAll("tbody tr.dg__row td:first-child").map((t) => t.text());
    expect(cells[0]).toBe("Charlie");
    // sort asc should keep pinned at top
    await w.findAll("thead th")[0].trigger("click");
    cells = w.findAll("tbody tr.dg__row td:first-child").map((t) => t.text());
    expect(cells[0]).toBe("Charlie");
  });

  it("virtualization activates when rows.length > 100 (default threshold)", () => {
    const big = Array.from({ length: 200 }, (_, i) => ({
      id: `r${i}`,
      name: `Row ${i}`,
      count: i,
    }));
    const w = mountGrid({ rows: big, bodyHeight: 200, estimatedRowHeight: 32 });
    expect(w.find(".dg").classes()).toContain("dg--virtualized");
    // Body has only ~visible+overscan rows rendered, not 200
    const renderedRows = w.findAll("tbody tr.dg__row").length;
    expect(renderedRows).toBeLessThan(big.length);
    expect(renderedRows).toBeGreaterThan(0);
  });
});
