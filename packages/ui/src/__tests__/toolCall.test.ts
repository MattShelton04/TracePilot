import { describe, it, expect } from "vitest";
import { formatArgsSummary } from "../utils/toolCall";

describe("formatArgsSummary", () => {
  it("should return empty string for invalid args types", () => {
    expect(formatArgsSummary(null, "view")).toBe("");
    expect(formatArgsSummary(undefined, "view")).toBe("");
    expect(formatArgsSummary("string arg", "view")).toBe("");
    expect(formatArgsSummary(123, "view")).toBe("");
    expect(formatArgsSummary(true, "view")).toBe("");
  });

  it("should return empty string when expected arguments are missing", () => {
    expect(formatArgsSummary({}, "view")).toBe("");
    expect(formatArgsSummary({ wrongKey: "value" }, "view")).toBe("");
  });

  it("should handle view tool", () => {
    expect(formatArgsSummary({ path: "src/index.ts" }, "view")).toBe("src/index.ts");
  });

  it("should handle edit tool", () => {
    expect(formatArgsSummary({ path: "src/index.ts" }, "edit")).toBe("src/index.ts");
  });

  it("should handle create tool", () => {
    expect(formatArgsSummary({ path: "src/index.ts" }, "create")).toBe("src/index.ts");
  });

  it("should handle grep tool with and without path", () => {
    expect(formatArgsSummary({ pattern: "test" }, "grep")).toBe("/test/");
    expect(formatArgsSummary({ pattern: "test", path: "src/" }, "grep")).toBe("/test/ in src/");
  });

  it("should handle glob tool", () => {
    expect(formatArgsSummary({ pattern: "*.ts" }, "glob")).toBe("*.ts");
  });

  it("should handle powershell tool and truncate long commands", () => {
    expect(formatArgsSummary({ command: "echo hello" }, "powershell")).toBe("echo hello");

    const longCmd = "a".repeat(160);
    const expectedCmd = "a".repeat(150) + "…";
    expect(formatArgsSummary({ command: longCmd }, "powershell")).toBe(expectedCmd);
  });

  it("should handle task tool", () => {
    expect(formatArgsSummary({ description: "my task" }, "task")).toBe("my task");
  });

  it("should handle report_intent tool", () => {
    expect(formatArgsSummary({ intent: "user intention" }, "report_intent")).toBe("user intention");
  });

  it("should handle sql tool", () => {
    expect(formatArgsSummary({ description: "db query" }, "sql")).toBe("db query");
  });

  it("should handle web_search tool", () => {
    expect(formatArgsSummary({ query: "vitest documentation" }, "web_search")).toBe("vitest documentation");
  });

  it("should handle web_fetch tool", () => {
    expect(formatArgsSummary({ url: "https://example.com" }, "web_fetch")).toBe("https://example.com");
  });

  it("should handle github-mcp-server tool prefix", () => {
    expect(formatArgsSummary({ method: "create_pull_request" }, "github-mcp-server")).toBe("create_pull_request");
    expect(formatArgsSummary({ method: "list_issues" }, "github-mcp-server-repo")).toBe("list_issues");
  });

  it("should return empty string for unknown tools", () => {
    expect(formatArgsSummary({ arg: "value" }, "unknown_tool")).toBe("");
  });
});
