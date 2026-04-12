import { describe, expect, it } from "vitest";
import { getToolArgs, toolArgString } from "../src/tool-args.js";

describe("getToolArgs", () => {
  it("returns the object when arguments is a plain object", () => {
    const tc = { arguments: { path: "/tmp/foo", command: "ls" } };
    const result = getToolArgs(tc);
    expect(result).toEqual({ path: "/tmp/foo", command: "ls" });
  });

  it("returns {} when arguments is undefined", () => {
    expect(getToolArgs({ arguments: undefined })).toEqual({});
  });

  it("returns {} when arguments is null", () => {
    expect(getToolArgs({ arguments: null })).toEqual({});
  });

  it("returns {} when arguments is a string (non-object)", () => {
    expect(getToolArgs({ arguments: "raw string" as unknown })).toEqual({});
  });

  it("returns {} when arguments is a number", () => {
    expect(getToolArgs({ arguments: 42 as unknown })).toEqual({});
  });

  it("returns {} when arguments is a boolean", () => {
    expect(getToolArgs({ arguments: true as unknown })).toEqual({});
  });

  it("returns {} when arguments is an array", () => {
    expect(getToolArgs({ arguments: [1, 2, 3] as unknown })).toEqual({});
  });

  it("returns the same reference for a valid object", () => {
    const obj = { model: "claude-sonnet-4.6" };
    const tc = { arguments: obj };
    expect(getToolArgs(tc)).toBe(obj);
  });

  it("returns {} for an empty object", () => {
    const tc = { arguments: {} };
    expect(getToolArgs(tc)).toEqual({});
    expect(Object.keys(getToolArgs(tc))).toHaveLength(0);
  });
});

describe("toolArgString", () => {
  it("returns the string value when key exists and is a string", () => {
    expect(toolArgString({ path: "/tmp/foo" }, "path")).toBe("/tmp/foo");
  });

  it("returns empty string for missing key", () => {
    expect(toolArgString({}, "path")).toBe("");
  });

  it("returns empty string for non-string value", () => {
    expect(toolArgString({ count: 42 }, "count")).toBe("");
  });

  it("returns empty string for null value", () => {
    expect(toolArgString({ name: null }, "name")).toBe("");
  });

  it("returns empty string for undefined value", () => {
    expect(toolArgString({ name: undefined }, "name")).toBe("");
  });

  it("returns empty string for boolean value", () => {
    expect(toolArgString({ flag: true }, "flag")).toBe("");
  });

  it("returns empty string for array value", () => {
    expect(toolArgString({ items: [1, 2] }, "items")).toBe("");
  });

  it("returns empty string for object value", () => {
    expect(toolArgString({ nested: { a: 1 } }, "nested")).toBe("");
  });

  it("returns custom fallback when provided", () => {
    expect(toolArgString({}, "missing", "default")).toBe("default");
    expect(toolArgString({ num: 42 }, "num", "N/A")).toBe("N/A");
  });

  it("returns empty string (not fallback) for present empty string", () => {
    expect(toolArgString({ name: "" }, "name", "fallback")).toBe("");
  });
});

describe("getToolArgs + toolArgString integration", () => {
  it("extracts a string from a tool call in one pipeline", () => {
    const tc = { arguments: { path: "/home/user/file.ts", command: "cat" } };
    const args = getToolArgs(tc);
    expect(toolArgString(args, "path")).toBe("/home/user/file.ts");
    expect(toolArgString(args, "command")).toBe("cat");
    expect(toolArgString(args, "missing")).toBe("");
  });

  it("handles null arguments gracefully", () => {
    const tc = { arguments: null };
    const args = getToolArgs(tc);
    expect(toolArgString(args, "path")).toBe("");
  });

  it("handles array arguments gracefully", () => {
    const tc = { arguments: ["a", "b"] as unknown };
    const args = getToolArgs(tc);
    expect(toolArgString(args, "0")).toBe("");
  });
});
