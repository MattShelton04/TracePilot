import type { McpServerConfig, McpTransport } from "@tracepilot/types";
import { computed, reactive, ref } from "vue";

export interface AddServerEnvPair {
  key: string;
  value: string;
}

export interface AddServerForm {
  name: string;
  command: string;
  args: string;
  url: string;
  transport: McpTransport;
  description: string;
  tags: string;
  scope: "global" | "project";
  workingDir: string;
  envPairs: AddServerEnvPair[];
}

export const transportOptions: { value: McpTransport; label: string; tooltip: string }[] = [
  { value: "stdio", label: "Stdio", tooltip: "Local subprocess — communicates via stdin/stdout" },
  { value: "sse", label: "SSE", tooltip: "Server-Sent Events — legacy remote transport" },
  { value: "http", label: "HTTP", tooltip: "Streamable HTTP — modern remote transport (MCP 2025 spec)" },
];

export function useAddServerForm(
  emit: (name: string, config: McpServerConfig) => void,
) {
  const submitting = ref(false);
  const validationError = ref("");
  const showAdvanced = ref(false);

  const form = reactive<AddServerForm>({
    name: "",
    command: "",
    args: "",
    url: "",
    transport: "stdio" as McpTransport,
    description: "",
    tags: "",
    scope: "global",
    workingDir: "",
    envPairs: [{ key: "", value: "" }],
  });

  const jsonPreview = computed(() => {
    const name = form.name || "my-server";
    const entry: Record<string, unknown> = {};

    if (form.transport === "stdio") {
      entry.command = form.command || "npx";
      const args = form.args
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (args.length > 0) entry.args = args;
    } else {
      entry.type = form.transport;
      entry.url = form.url || "http://localhost:3000/mcp";
    }

    const env: Record<string, string> = {};
    for (const pair of form.envPairs) {
      if (pair.key.trim()) env[pair.key.trim()] = pair.value;
    }
    if (Object.keys(env).length > 0) entry.env = env;

    return JSON.stringify({ mcpServers: { [name]: entry } }, null, 2);
  });

  function addEnvPair() {
    form.envPairs.push({ key: "", value: "" });
  }

  function removeEnvPair(index: number) {
    form.envPairs.splice(index, 1);
    if (form.envPairs.length === 0) {
      form.envPairs.push({ key: "", value: "" });
    }
  }

  function validate(): boolean {
    validationError.value = "";

    if (!form.name.trim()) {
      validationError.value = "Server name is required.";
      return false;
    }

    if (form.transport === "stdio" && !form.command.trim()) {
      validationError.value = "Command is required for stdio transport.";
      return false;
    }

    if ((form.transport === "sse" || form.transport === "http" || form.transport === "streamable-http") && !form.url.trim()) {
      validationError.value = "URL is required for SSE/HTTP transport.";
      return false;
    }

    return true;
  }

  async function handleSubmit() {
    if (!validate()) return;

    submitting.value = true;

    const env: Record<string, string> = {};
    for (const pair of form.envPairs) {
      if (pair.key.trim()) {
        env[pair.key.trim()] = pair.value;
      }
    }

    const config: McpServerConfig = {
      command: form.command || undefined,
      args: form.args
        ? form.args
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
      env: Object.keys(env).length > 0 ? env : undefined,
      url: form.url || undefined,
      type: form.transport,
      description: form.description || undefined,
      tags: form.tags
        ? form.tags
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
      enabled: true,
    };

    emit(form.name.trim(), config);
    submitting.value = false;
  }

  return {
    form,
    submitting,
    validationError,
    showAdvanced,
    jsonPreview,
    addEnvPair,
    removeEnvPair,
    handleSubmit,
  };
}
