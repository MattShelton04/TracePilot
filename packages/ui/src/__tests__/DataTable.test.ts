import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import DataTable from "../components/DataTable.vue";

it("keeps existing columns static unless sorting is enabled", () => {
  const wrapper = mount(DataTable, {
    props: {
      columns: [{ key: "name", label: "Name" }],
      rows: [{ name: "Worker" }],
    },
  });
  expect(wrapper.get("th").text()).toBe("Name");
  expect(wrapper.find("th button").exists()).toBe(false);
  expect(wrapper.get("th").attributes("aria-sort")).toBeUndefined();
  expect(wrapper.get("td").text()).toBe("Worker");
});

it("exposes controlled sort state and emits header activations", async () => {
  const wrapper = mount(DataTable, {
    props: {
      columns: [{ key: "credits", label: "Credits", sortable: true }],
      rows: [],
    },
  });
  expect(wrapper.get("th").attributes("aria-sort")).toBe("none");
  await wrapper.get('button[aria-label="Sort by Credits"]').trigger("click");
  expect(wrapper.emitted("sort")).toEqual([["credits"]]);
  await wrapper.setProps({ sortKey: "credits", sortDirection: "descending" });
  expect(wrapper.get("th").attributes("aria-sort")).toBe("descending");
  await wrapper.setProps({ sortDirection: "ascending" });
  expect(wrapper.get("th").attributes("aria-sort")).toBe("ascending");
});

it("stays unexpandable unless the parent passes expanded keys", () => {
  const wrapper = mount(DataTable, {
    props: { columns: [{ key: "name", label: "Name" }], rows: [{ name: "Worker" }] },
  });
  expect(wrapper.findAll("th")).toHaveLength(1);
  expect(wrapper.find(".data-table-toggle").exists()).toBe(false);
});

it("expands rows by key into a full-width detail row", async () => {
  const wrapper = mount(DataTable, {
    props: {
      columns: [
        { key: "id", label: "ID" },
        { key: "name", label: "Name" },
      ],
      rows: [
        { id: "a", name: "First" },
        { id: "b", name: "Second" },
      ],
      rowKey: "id",
      expandedKeys: ["b"],
      expandLabel: (row: Record<string, unknown>) => `Details for ${row.name}`,
    },
    slots: { expanded: `<template #expanded="{ row }">About {{ row.name }}</template>` },
  });

  const toggles = wrapper.findAll("button.data-table-toggle");
  expect(toggles.map((toggle) => toggle.attributes("aria-expanded"))).toEqual(["false", "true"]);
  expect(toggles[0].attributes("aria-label")).toBe("Details for First");
  const detail = wrapper.get(".data-table-expanded");
  expect(detail.text()).toBe("About Second");
  expect(detail.findAll("td")[1].attributes("colspan")).toBe("2");

  // The toggle and a click anywhere on the row both ask; the parent decides.
  await toggles[0].trigger("click");
  await wrapper.findAll("tbody tr")[0].trigger("click");
  expect(wrapper.emitted("toggle")).toEqual([["a"], ["a"]]);
});
