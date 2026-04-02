import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CliError,
  handleCommandError,
  handleValidationError,
  wrapCommand,
} from "../../utils/errorHandler.js";

describe("utils/errorHandler", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {}) as unknown as ReturnType<
      typeof vi.spyOn
    >;
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never) as unknown as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints CliError message and exits", () => {
    expect(() => handleCommandError(new CliError("bad input"), "Failed")).toThrow("process.exit:1");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed:"), "bad input");
  });

  it("prints Error message + stack and exits", () => {
    const err = new Error("boom");
    err.stack = "Error: boom\n at test";
    expect(() => handleCommandError(err, "Context")).toThrow("process.exit:1");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Context:"), "boom");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Error: boom"));
  });

  it("prints cause when available", () => {
    const err = new Error("top", { cause: "root-cause" });
    err.stack = "Error: top";
    expect(() => handleCommandError(err, "Ctx")).toThrow("process.exit:1");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Caused by:"), "root-cause");
  });

  it("prints string errors and exits", () => {
    expect(() => handleCommandError("oops", "Context")).toThrow("process.exit:1");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Context:"), "oops");
  });

  it("prints unknown errors and exits", () => {
    const payload = { detail: "x" };
    expect(() => handleCommandError(payload)).toThrow("process.exit:1");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Error:"), payload);
  });

  it("handleValidationError prints message and exits", () => {
    expect(() => handleValidationError("invalid")).toThrow("process.exit:1");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("invalid"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("wrapCommand returns result when successful", async () => {
    const result = await wrapCommand(async () => 42, "Context");
    expect(result).toBe(42);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("wrapCommand delegates error handling and exits", async () => {
    await expect(
      wrapCommand(async () => {
        throw new CliError("nope");
      }, "Context"),
    ).rejects.toThrow("process.exit:1");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Context:"), "nope");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
