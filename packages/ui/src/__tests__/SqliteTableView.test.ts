import type { SessionDbTable } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SqliteTableView from "../components/SqliteTableView.vue";

const emptyTable: SessionDbTable = {
  name: "todo_deps",
  columns: ["todo_id", "depends_on"],
  rows: [],
  columnInfo: [
    { name: "todo_id", typeName: "TEXT", notnull: true, pk: 1, defaultValue: null },
    { name: "depends_on", typeName: "TEXT", notnull: true, pk: 2, defaultValue: null },
  ],
  indexes: [
    { name: "sqlite_autoindex_todo_deps_1", unique: true, columns: ["todo_id", "depends_on"] },
  ],
};

const populatedTable: SessionDbTable = {
  name: "todos",
  columns: ["id", "title", "status"],
  rows: [
    ["t1", "Fix bug", "done"],
    [
      "t2",
      "Write docs with a very long description that will definitely overflow any reasonable column width and need expansion",
      "pending",
    ],
  ],
  columnInfo: [
    { name: "id", typeName: "TEXT", notnull: true, pk: 1, defaultValue: null },
    { name: "title", typeName: "TEXT", notnull: true, pk: 0, defaultValue: null },
    { name: "status", typeName: "TEXT", notnull: false, pk: 0, defaultValue: "'pending'" },
  ],
  indexes: [],
};

describe("SqliteTableView", () => {
  it("renders column headers even for an empty table and shows empty-state row", () => {
    const wrapper = mount(SqliteTableView, { props: { table: emptyTable } });

    // Headers are present despite zero rows.
    const ths = wrapper.findAll(".stv__th-label");
    expect(ths.map((t) => t.text())).toEqual(["todo_id", "depends_on"]);

    // Empty row is rendered as a single spanning cell.
    const empty = wrapper.find(".stv__empty-row");
    expect(empty.exists()).toBe(true);
    expect(empty.attributes("colspan")).toBe("2");
    expect(empty.text()).toContain("No rows in");
    expect(empty.text()).toContain("todo_deps");
  });

  it("exposes Data and Schema tabs, Schema lists columns + indexes", async () => {
    const wrapper = mount(SqliteTableView, { props: { table: emptyTable } });

    const modes = wrapper.findAll(".stv__mode");
    expect(modes.length).toBe(2);
    expect(modes[0].text()).toContain("Data");
    expect(modes[1].text()).toContain("Schema");

    await modes[1].trigger("click");
    expect(wrapper.find(".stv__schema-wrap").exists()).toBe(true);
    // Column names in schema
    expect(wrapper.text()).toContain("todo_id");
    expect(wrapper.text()).toContain("NOT NULL");
    // PK positions
    expect(wrapper.text()).toContain("PK");
    expect(wrapper.text()).toContain("PK2");
    // Index listed
    expect(wrapper.text()).toContain("sqlite_autoindex_todo_deps_1");
  });

  it("opens the cell-expand modal with the full value when a cell is clicked", async () => {
    const wrapper = mount(SqliteTableView, {
      props: { table: populatedTable },
      attachTo: document.body,
    });

    const cells = wrapper.findAll(".stv__td");
    // Second row, second cell contains the long title.
    const longCell = cells.find((c) => c.text().startsWith("Write docs"));
    expect(longCell).toBeTruthy();
    await longCell!.trigger("click");

    // Modal is teleported to body — query the document directly.
    const modalValue = document.querySelector(".stv__cell-value");
    expect(modalValue?.textContent).toContain("overflow any reasonable column width");
    wrapper.unmount();
  });

  it("resizes a column width via the drag handle", async () => {
    const wrapper = mount(SqliteTableView, {
      props: { table: populatedTable },
      attachTo: document.body,
    });

    const handles = wrapper.findAll(".stv__th-handle");
    expect(handles.length).toBe(3);
    // Initial width for column 0 should be the default 180px.
    const colBefore = wrapper.find("col");
    expect(colBefore.attributes("style")).toContain("180px");

    await handles[0].trigger("mousedown", { clientX: 200 });
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 300 }));
    document.dispatchEvent(new MouseEvent("mouseup"));
    await wrapper.vm.$nextTick();

    const colAfter = wrapper.find("col");
    // Width should be default + 100 = 280px
    expect(colAfter.attributes("style")).toContain("280px");
    wrapper.unmount();
  });
});
