import { describe, expect, it } from "vitest";
import { formatUsd } from "../charts";

describe("formatUsd (Models page)", () => {
  it.each([
    [null, "—"],
    [0, "$0"],
    [0.0049, "<$0.01"],
    [0.005, "$0.01"],
    [0.0099, "$0.01"],
    [0.37, "$0.37"],
    [9.95, "$9.95"],
    [9.994, "$9.99"],
    [9.996, "$10.0"],
    [47.44, "$47.4"],
    [999.94, "$999.9"],
    [999.96, "$1,000"],
    [1234.56, "$1,235"],
    [1_093_400, "$1,093,400"],
  ] as const)("formats %s as %s", (value, expected) => {
    expect(formatUsd(value)).toBe(expected);
  });
});
