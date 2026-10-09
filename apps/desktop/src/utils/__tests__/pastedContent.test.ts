import { describe, expect, it } from "vitest";
import { splitPastedContent } from "../pastedContent";

describe("splitPastedContent", () => {
  it("keeps a prompt without pasted text as one part", () => {
    const prompt = "Add a retry.\n\nUse <b>three</b> attempts.";
    expect(splitPastedContent(prompt)).toEqual([{ kind: "text", text: prompt }]);
  });

  it("separates typed text from each pasted block", () => {
    const prompt =
      'Do this:\n\n<pasted_content id="5746">\n- one\n- two\n</pasted_content id="5746">\n\nThen <pasted_content id="7">\nx\n</pasted_content id="7">';
    expect(splitPastedContent(prompt)).toEqual([
      { kind: "text", text: "Do this:" },
      { kind: "pasted", text: "- one\n- two" },
      { kind: "text", text: "Then" },
      { kind: "pasted", text: "x" },
    ]);
  });

  it("accepts a block without an id and leaves unmatched tags as text", () => {
    expect(splitPastedContent("<pasted_content>\nbody\n</pasted_content>")).toEqual([
      { kind: "pasted", text: "body" },
    ]);
    const unmatched = '<pasted_content id="1">\nno closing tag';
    expect(splitPastedContent(unmatched)).toEqual([{ kind: "text", text: unmatched }]);
    const mismatched = '<pasted_content id="1">\nx\n</pasted_content id="2">';
    expect(splitPastedContent(mismatched)).toEqual([{ kind: "text", text: mismatched }]);
  });
});
