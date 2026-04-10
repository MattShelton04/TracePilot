import { describe, expect, it } from "vitest";
import { formatArgsSummary, toolCategory } from "../utils/toolCall";

describe("toolCategory", () => {
  it("returns 'file' for file-related tools", () => {
    const tools = ["view", "edit", "create", "grep", "glob"];
    for (const tool of tools) {
      expect(toolCategory(tool)).toBe("file");
    }
  });

  it("returns 'shell' for shell-related tools", () => {
    const tools = ["powershell", "read_powershell", "write_powershell", "stop_powershell"];
    for (const tool of tools) {
      expect(toolCategory(tool)).toBe("shell");
    }
  });

  it("returns 'agent' for agent-related tools", () => {
    const tools = ["task", "read_agent", "write_agent", "list_agents"];
    for (const tool of tools) {
      expect(toolCategory(tool)).toBe("agent");
    }
  });

  it("returns 'github' for tools starting with 'github-mcp-server'", () => {
    expect(toolCategory("github-mcp-server")).toBe("github");
    expect(toolCategory("github-mcp-server-repo")).toBe("github");
    expect(toolCategory("github-mcp-server-issues")).toBe("github");
  });

  it("returns 'web' for web-related tools", () => {
    const tools = ["web_search", "web_fetch"];
    for (const tool of tools) {
      expect(toolCategory(tool)).toBe("web");
    }
  });

  it("returns 'data' for sql tool", () => {
    expect(toolCategory("sql")).toBe("data");
  });

  it("returns 'other' for unknown tools or empty string", () => {
    expect(toolCategory("unknown_tool")).toBe("other");
    expect(toolCategory("")).toBe("other");
    expect(toolCategory("random")).toBe("other");
  });
});

describe("formatArgsSummary", () => {
  it("returns empty string for falsy or non-object args", () => {
    expect(formatArgsSummary(null, "view")).toBe("");
    expect(formatArgsSummary(undefined, "view")).toBe("");
    expect(formatArgsSummary("string", "view")).toBe("");
    expect(formatArgsSummary(123, "view")).toBe("");
    expect(formatArgsSummary(true, "view")).toBe("");
  });

  it("returns empty string for unmatched toolName or missing arguments", () => {
    expect(formatArgsSummary({}, "view")).toBe("");
    expect(formatArgsSummary({ someArg: "value" }, "unknown_tool")).toBe("");
  });

  it("formats 'view', 'edit', 'create' with path", () => {
    expect(formatArgsSummary({ path: "/foo/bar.txt" }, "view")).toBe("/foo/bar.txt");
    expect(formatArgsSummary({ path: "/foo/bar.txt" }, "edit")).toBe("/foo/bar.txt");
    expect(formatArgsSummary({ path: "/foo/bar.txt" }, "create")).toBe("/foo/bar.txt");
  });

  it("formats 'grep' with pattern and optionally path", () => {
    expect(formatArgsSummary({ pattern: "search_term" }, "grep")).toBe("/search_term/");
    expect(formatArgsSummary({ pattern: "search_term", path: "/src" }, "grep")).toBe(
      "/search_term/ in /src",
    );
  });

  it("formats 'glob' with pattern", () => {
    expect(formatArgsSummary({ pattern: "*.ts" }, "glob")).toBe("*.ts");
  });

  it("formats 'powershell' with command and truncates if > 150 chars", () => {
    expect(formatArgsSummary({ command: "ls -la" }, "powershell")).toBe("ls -la");

    const longCommand = "a".repeat(200);
    const expectedTruncated = "a".repeat(150) + "…";
    expect(formatArgsSummary({ command: longCommand }, "powershell")).toBe(expectedTruncated);
  });

  it("does not truncate powershell command at exactly 150 chars", () => {
    const exact150 = "b".repeat(150);
    expect(formatArgsSummary({ command: exact150 }, "powershell")).toBe(exact150);
  });

  it("formats 'task' with description", () => {
    expect(formatArgsSummary({ description: "run tests" }, "task")).toBe("run tests");
  });

  it("formats 'read_agent' with agent_id, agent_name, or name", () => {
    expect(formatArgsSummary({ agent_id: "agent-123" }, "read_agent")).toBe("agent-123");
    expect(formatArgsSummary({ agent_name: "test-agent" }, "read_agent")).toBe("test-agent");
    expect(formatArgsSummary({ name: "fallback-name" }, "read_agent")).toBe("fallback-name");

    // Priority: agent_id > agent_name > name
    expect(
      formatArgsSummary({ agent_id: "id", agent_name: "name", name: "fallback" }, "read_agent"),
    ).toBe("id");
    expect(formatArgsSummary({ agent_name: "name", name: "fallback" }, "read_agent")).toBe("name");
  });

  it("formats 'report_intent' with intent", () => {
    expect(formatArgsSummary({ intent: "user_intent" }, "report_intent")).toBe("user_intent");
  });

  it("formats 'sql' with description", () => {
    expect(formatArgsSummary({ description: "fetch users" }, "sql")).toBe("fetch users");
  });

  it("formats 'web_search' with query", () => {
    expect(formatArgsSummary({ query: "how to code" }, "web_search")).toBe("how to code");
  });

  it("formats 'web_fetch' with url", () => {
    expect(formatArgsSummary({ url: "https://example.com" }, "web_fetch")).toBe(
      "https://example.com",
    );
  });

  it("formats 'github-mcp-server-*' with method", () => {
    expect(formatArgsSummary({ method: "GET" }, "github-mcp-server-1")).toBe("GET");
    expect(formatArgsSummary({ method: "POST" }, "github-mcp-server-2")).toBe("POST");
  });
});
