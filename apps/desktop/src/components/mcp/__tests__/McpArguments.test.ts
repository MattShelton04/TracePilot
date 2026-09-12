import type { McpServerConfig } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { useAddServerForm } from "../addServer/useAddServerForm";
import McpConfigEditor from "../McpConfigEditor.vue";

describe("MCP process arguments", () => {
  it("preserves comma-containing arguments in the add preview and submitted configuration", async () => {
    const submit = vi.fn<(name: string, config: McpServerConfig) => void>();
    const { form, jsonPreview, handleSubmit } = useAddServerForm(submit);
    form.name = "audit-server";
    form.command = "node";
    form.args = '--headers=a,b\r\n\r\nC:/Projects/Client, Inc/server.js\n{"values":[1,2]}';
    const expected = ["--headers=a,b", "C:/Projects/Client, Inc/server.js", '{"values":[1,2]}'];

    expect(JSON.parse(jsonPreview.value).mcpServers["audit-server"].args).toEqual(expected);
    await handleSubmit();
    expect(submit).toHaveBeenCalledWith(
      "audit-server",
      expect.objectContaining({ args: expected }),
    );
  });

  it("round-trips existing comma arguments through unrelated edits and argument edits", async () => {
    const args = ["--headers=a,b", "C:/Projects/Client, Inc/server.js", '{"values":[1,2]}'];
    const editor = mount(McpConfigEditor, {
      props: { config: { command: "node", type: "stdio", enabled: true, args } },
    });

    expect(editor.get<HTMLTextAreaElement>("#mcp-args").element.value).toBe(args.join("\n"));
    expect(editor.get<HTMLTextAreaElement>("#mcp-args").element.readOnly).toBe(false);
    expect(editor.find("#mcp-args-help").exists()).toBe(false);
    await editor.get("#mcp-description").setValue("Updated description");
    expect(editor.emitted("update:config")?.at(-1)?.[0]).toMatchObject({ args });

    await editor.get("#mcp-args").setValue(`${args.join("\n")}\n--include=x,y\n`);
    expect(editor.emitted("update:config")?.at(-1)?.[0]).toMatchObject({
      args: [...args, "--include=x,y"],
    });
    editor.unmount();
  });

  it.each([
    { name: "multiline", args: ["-e", "console.log('first')\nconsole.log('second')"] },
    { name: "empty", args: ["--label", ""] },
    { name: "whitespace", args: [" leading", "trailing "] },
    { name: "carriage return", args: ["--label", "value\r"] },
    { name: "embedded carriage return", args: ["--label", "first\rsecond"] },
  ])("preserves $name arguments when metadata and environment values change", async ({ args }) => {
    const editor = mount(McpConfigEditor, {
      props: {
        serverName: "audit-server",
        config: { command: "node", type: "stdio", enabled: true, args, env: { AUDIT: "before" } },
      },
    });

    await editor.get("#mcp-description").setValue("Updated description");
    const updated = editor.emitted("update:config")?.at(-1)?.[0] as McpServerConfig;
    expect(updated).toMatchObject({ args, description: "Updated description" });
    await editor.setProps({ config: updated });
    await editor.get('[aria-label="Environment variable 1 value"]').setValue("after");
    expect(editor.emitted("update:config")?.at(-1)?.[0]).toMatchObject({
      args,
      description: "Updated description",
      env: { AUDIT: "after" },
    });

    const argumentsField = editor.get<HTMLTextAreaElement>("#mcp-args");
    expect(argumentsField.element.readOnly).toBe(true);
    expect(argumentsField.attributes("aria-describedby")).toBe("mcp-args-help");
    expect(editor.get("#mcp-args-help").text()).toContain("JSON configuration");
    editor.unmount();
  });

  it("updates argument editing availability when switching servers", async () => {
    const editor = mount(McpConfigEditor, {
      props: {
        serverName: "multiline-server",
        config: { command: "node", enabled: true, args: ["-e", "first\nsecond"] },
      },
    });
    await editor.setProps({
      serverName: "normal-server",
      config: { command: "node", enabled: true, args: ["--headers=a,b"] },
    });

    const argumentsField = editor.get<HTMLTextAreaElement>("#mcp-args");
    expect(argumentsField.element.readOnly).toBe(false);
    expect(argumentsField.element.value).toBe("--headers=a,b");
    await argumentsField.setValue("--label=two words");
    expect(editor.emitted("update:config")?.at(-1)?.[0]).toMatchObject({
      args: ["--label=two words"],
    });
    editor.unmount();
  });
});
