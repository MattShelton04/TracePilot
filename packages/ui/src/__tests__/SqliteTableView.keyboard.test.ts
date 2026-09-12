import type { SessionDbTable } from "@tracepilot/types";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import SqliteTableView from "../components/SqliteTableView.vue";

enableAutoUnmount(afterEach);
afterEach(() => {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  vi.restoreAllMocks();
});

const note = "Long Unicode note — café 日本語. ".repeat(30);
const table: SessionDbTable = {
  name: "audit_metrics",
  columns: ["name", "value", "count", "note"],
  rows: Array.from({ length: 120 }, (_, index) => [`Row ${index + 1}`, null, 0, note]),
  columnInfo: [],
  indexes: [],
};

function createWrapper() {
  return mount(SqliteTableView, { props: { table }, attachTo: document.body });
}

describe("SQLite table keyboard access", () => {
  it("keeps table semantics and one data tab stop for a large result", () => {
    const wrapper = createWrapper();
    expect(wrapper.get("table").attributes("role")).toBeUndefined();
    const buttons = wrapper.findAll<HTMLButtonElement>(".stv__cell-button");
    expect(buttons).toHaveLength(480);
    expect(buttons.filter((button) => button.element.tabIndex === 0)).toHaveLength(1);
    expect(buttons[1].attributes("aria-label")).toBe("View value, row 1");
    expect(buttons[1].text()).toBe("NULL");
    expect(buttons[2].text()).toBe("0");
    const hintIds = (buttons[0].attributes("aria-describedby") ?? "").split(" ");
    expect(hintIds.map((id) => wrapper.get(`[id="${id}"]`).text()).join(" ")).toContain(
      "Arrow keys",
    );
  });

  it("moves between cells and row/table boundaries without adding tab stops", async () => {
    const wrapper = createWrapper();
    const buttons = wrapper.findAll<HTMLButtonElement>(".stv__cell-button");
    buttons[0].element.focus();
    await buttons[0].trigger("keydown", { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[1].element);
    await buttons[1].trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[5].element);
    await buttons[5].trigger("keydown", { key: "End" });
    expect(document.activeElement).toBe(buttons[7].element);
    await buttons[7].trigger("keydown", { key: "Home" });
    expect(document.activeElement).toBe(buttons[4].element);
    await buttons[4].trigger("keydown", { key: "End", ctrlKey: true });
    expect(document.activeElement).toBe(buttons[479].element);
    await buttons[479].trigger("keydown", { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[479].element);
    await buttons[479].trigger("keydown", { key: "Home", ctrlKey: true });
    expect(document.activeElement).toBe(buttons[0].element);
    expect(buttons.filter((button) => button.element.tabIndex === 0)).toHaveLength(1);
  });

  it("preserves the active column and clamps it when switching table shapes", async () => {
    const wrapper = createWrapper();
    const lastColumn = wrapper.findAll<HTMLButtonElement>(".stv__cell-button")[3];
    lastColumn.element.focus();
    await nextTick();
    await wrapper.setProps({
      table: { ...table, name: "other", columns: ["a", "b"], rows: [[1, 2]] },
    });
    const other = wrapper.findAll<HTMLButtonElement>(".stv__cell-button");
    expect(other[0].element.tabIndex).toBe(-1);
    expect(other[1].element.tabIndex).toBe(0);
    await wrapper.setProps({ table: { ...table, rows: [] } });
    expect(wrapper.findAll(".stv__cell-button")).toHaveLength(0);
    await wrapper.setProps({ table });
    expect(wrapper.findAll<HTMLButtonElement>(".stv__cell-button")[1].element.tabIndex).toBe(0);
  });

  it("opens the full Unicode value and restores the invoking cell on Escape", async () => {
    const wrapper = createWrapper();
    const button = wrapper.findAll<HTMLButtonElement>(".stv__cell-button")[3];
    expect(button.element.tagName).toBe("BUTTON");
    expect(button.attributes("type")).toBe("button");
    button.element.focus();
    await button.trigger("click");
    await nextTick();
    expect(document.querySelector(".stv__cell-value")?.textContent).toBe(note);
    expect(document.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await nextTick();
    await nextTick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button.element);
    expect(button.element.tabIndex).toBe(0);
  });

  it("resizes with keyboard bounds and reset while retaining per-table widths", async () => {
    const wrapper = createWrapper();
    const handle = wrapper.get<HTMLSpanElement>(".stv__th-handle");
    expect(handle.element.tabIndex).toBe(0);
    expect(handle.attributes("aria-valuemin")).toBe("48");
    expect(handle.attributes("aria-valuemax")).toBe("4096");
    expect(handle.attributes("aria-valuenow")).toBe("180");
    await handle.trigger("keydown", { key: "ArrowRight" });
    expect(handle.attributes("aria-valuenow")).toBe("196");
    await handle.trigger("keydown", { key: "ArrowLeft", shiftKey: true });
    expect(handle.attributes("aria-valuenow")).toBe("132");
    await handle.trigger("keydown", { key: "Home" });
    await handle.trigger("keydown", { key: "ArrowLeft" });
    expect(handle.attributes("aria-valuenow")).toBe("48");
    await handle.trigger("keydown", { key: "End" });
    await handle.trigger("keydown", { key: "ArrowRight" });
    expect(handle.attributes("aria-valuenow")).toBe("4096");
    await handle.trigger("keydown", { key: "Enter" });
    expect(handle.attributes("aria-valuetext")).toBe("180 pixels");
    await handle.trigger("keydown", { key: "ArrowRight" });
    await wrapper.setProps({ table: { ...table, name: "other", columns: ["a"], rows: [[1]] } });
    expect(wrapper.get(".stv__th-handle").attributes("aria-valuenow")).toBe("180");
    await wrapper.setProps({ table });
    expect(wrapper.get(".stv__th-handle").attributes("aria-valuenow")).toBe("196");
  });

  it("cleans up a pending drag and restores existing document styles on unmount", async () => {
    const wrapper = createWrapper();
    document.body.style.cursor = "crosshair";
    document.body.style.userSelect = "text";
    const removeListener = vi.spyOn(document, "removeEventListener");
    await wrapper.get(".stv__th-handle").trigger("mousedown", { clientX: 100 });
    expect(document.body.style.cursor).toBe("col-resize");
    wrapper.unmount();
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.body.style.userSelect).toBe("text");
    expect(removeListener).toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith("mouseup", expect.any(Function));
  });

  it("ends a drag before table changes so later movement cannot resize the new table", async () => {
    const wrapper = createWrapper();
    await wrapper.get(".stv__th-handle").trigger("mousedown", { clientX: 100 });
    await wrapper.setProps({ table: { ...table, name: "other", columns: ["a"], rows: [[1]] } });
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 500 }));
    await nextTick();
    expect(wrapper.get("col").attributes("style")).toContain("180px");
    expect(document.body.style.cursor).toBe("");
  });
});
