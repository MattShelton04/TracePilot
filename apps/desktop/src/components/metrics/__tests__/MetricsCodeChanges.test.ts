import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MetricsCodeChanges from "../MetricsCodeChanges.vue";

describe("MetricsCodeChanges", () => {
  it("bounds a large file list while keeping later files searchable and reachable", async () => {
    const files = Array.from({ length: 3000 }, (_, i) => `src/module-${i}.ts`);
    const wrapper = mount(MetricsCodeChanges, {
      props: { metrics: { codeChanges: { filesModified: files, linesAdded: 9000 } } },
    });
    expect(wrapper.findAll("tbody tr")).toHaveLength(20);
    expect(wrapper.text()).toContain("3000 of 3000 files");
    await wrapper.get("nav button:last-child").trigger("click");
    expect(wrapper.get("tbody tr").text()).toBe("src/module-20.ts");
    await wrapper.get("input").setValue("module-2999");
    expect(wrapper.findAll("tbody tr")).toHaveLength(1);
    expect(wrapper.get("tbody").text()).toContain("src/module-2999.ts");
    expect(wrapper.find("nav").exists()).toBe(false);
    await wrapper.get("input").setValue("absent");
    expect(wrapper.text()).toContain("No files match this path.");
    await wrapper.get("input").setValue("");
    expect(wrapper.get("tbody tr").text()).toBe("src/module-0.ts");
  });
});
