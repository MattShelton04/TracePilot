import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import McpAddServerModal from "../McpAddServerModal.vue";
import McpConfigEditor from "../McpConfigEditor.vue";

describe("MCP configuration keyboard access", () => {
  let wrapper: VueWrapper | undefined;
  let opener: HTMLButtonElement | undefined;

  afterEach(async () => {
    wrapper?.unmount();
    wrapper = undefined;
    await nextTick();
    opener?.remove();
    opener = undefined;
  });

  async function mountModal() {
    opener = document.createElement("button");
    opener.textContent = "Add Server";
    document.body.append(opener);
    opener.focus();
    wrapper = mount(McpAddServerModal, {
      attachTo: document.body,
      global: { stubs: { Teleport: true } },
    });
    await nextTick();
    return wrapper;
  }

  it("focuses Server Name, contains Tab, closes on Escape and returns focus", async () => {
    const modal = await mountModal();
    expect(modal.get('[role="dialog"]').attributes("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(modal.get("input").element);
    const close = modal.get<HTMLButtonElement>(".modal-close");
    const submit = modal.get<HTMLButtonElement>(".btn-add");
    submit.element.focus();
    await submit.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(close.element);
    await close.trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(submit.element);

    await submit.trigger("keydown", { key: "Escape" });
    expect(modal.emitted("close")).toHaveLength(1);
    modal.unmount();
    wrapper = undefined;
    await nextTick();
    expect(document.activeElement).toBe(opener);
  });

  it("associates field labels, exposes transport state and explains the global configuration", async () => {
    const modal = await mountModal();
    function expectLabel(text: string) {
      const label = modal.findAll("label").find((candidate) => candidate.text().startsWith(text));
      expect(label, `Missing label ${text}`).toBeDefined();
      const control = modal.get(`[id="${label?.attributes("for")}"]`);
      expect(["INPUT", "TEXTAREA"]).toContain(control.element.tagName);
    }
    for (const text of ["Server Name", "Command", "Arguments", "Description", "Tags"]) {
      expectLabel(text);
    }
    expect(modal.get('.transport-pill[aria-pressed="true"]').text()).toBe("Stdio");
    await modal.findAll(".transport-pill")[2].trigger("click");
    expectLabel("URL");
    expect(modal.get('.transport-pill[aria-pressed="true"]').text()).toBe("HTTP");

    expect(modal.get(".config-location-note").text()).toContain("configuration applies globally");
    expect(modal.text()).not.toContain("Working Directory");
    expect(modal.text()).not.toContain("Advanced Options");
  });

  it("names environment rows and their actions, including rows added and removed", async () => {
    const modal = await mountModal();
    await modal.get('[aria-label="Environment variable 1 name"]').setValue("AUDIT_OPTION");
    await modal.get('[aria-label="Environment variable 1 value"]').setValue("enabled");
    await modal.get('[aria-label="Add environment variable"]').trigger("click");
    expect(modal.find('[aria-label="Environment variable 2 name"]').exists()).toBe(true);
    await modal.get('[aria-label="Remove environment variable 1"]').trigger("click");
    expect(modal.findAll(".env-row-modal")).toHaveLength(1);
    expect(
      modal.get<HTMLInputElement>('[aria-label="Environment variable 1 name"]').element.value,
    ).toBe("");
  });

  it("announces Add Server validation errors", async () => {
    const modal = await mountModal();
    await modal.get(".btn-add").trigger("click");
    expect(modal.get('[role="alert"]').text()).toBe("Server name is required.");
    expect(modal.emitted("submit")).toBeUndefined();
  });

  it("distinguishes environment and header row actions in the editor", async () => {
    wrapper = mount(McpConfigEditor, {
      props: {
        config: {
          enabled: true,
          type: "http",
          url: "http://localhost/mcp",
          env: { AUDIT_OPTION: "enabled" },
          headers: { "X-Audit-Option": "enabled" },
        },
      },
    });
    expect(wrapper.find('[aria-label="Environment variable 1 name"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Environment variable 1 value"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="HTTP header 1 name"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="HTTP header 1 value"]').exists()).toBe(true);

    await wrapper.get('[aria-label="Add HTTP header"]').trigger("click");
    await wrapper.get('[aria-label="Remove HTTP header 1"]').trigger("click");
    expect(wrapper.find('[aria-label="HTTP header 2 name"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Environment variable 1 name"]').exists()).toBe(true);
    await wrapper.get('[aria-label="Remove environment variable 1"]').trigger("click");
    const updates = wrapper.emitted("update:config");
    expect(updates?.[updates.length - 1][0]).toMatchObject({ env: undefined, headers: undefined });
  });
});
