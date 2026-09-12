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
