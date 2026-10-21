import { describe, expect, it } from "vitest";
import { effectScope } from "vue";
import { createQuerySlice } from "../../../stores/search/query";
import { describeSearchText } from "../../../stores/search/queryTerms";

describe("describeSearchText", () => {
  it("counts words, phrases and prefixes as terms, including lowercase operator words", () => {
    for (const text of [
      "error",
      "cache tier not recorded",
      "command not found",
      "not",
      "nearby",
      '"rate limit"',
      "auth*",
      "error NOT timeout",
    ]) {
      expect(describeSearchText(text).hasTerms, text).toBe(true);
    }
  });

  it("finds no terms in symbols, bare operators or a leading NOT's own term", () => {
    for (const text of ["*", "((", "!!!", "_", '""', '"!!"', "NOT", "AND OR", "NEAR", "NOT jwt"]) {
      expect(describeSearchText(text).hasTerms, text).toBe(false);
    }
  });

  it("counts an operator word with a prefix star as a term, as the indexer does", () => {
    for (const text of ["OR*", "AND*", "NOT*", "NEAR*", "NOT* found", "ready OR*", "(OR*)"]) {
      expect(describeSearchText(text).hasTerms, text).toBe(true);
      expect(describeSearchText(text).startsWithNot, text).toBe(false);
    }
  });

  it("keeps bare operators as operators next to starred ones", () => {
    expect(describeSearchText("OR").hasTerms).toBe(false);
    expect(describeSearchText("NOT").hasTerms).toBe(false);
    expect(describeSearchText("NOT").startsWithNot).toBe(true);
    expect(describeSearchText("NOT OR*")).toEqual({ hasTerms: false, startsWithNot: true });
    expect(describeSearchText("*** NOT jwt")).toEqual({ hasTerms: false, startsWithNot: true });
    expect(describeSearchText("ready OR")).toEqual({ hasTerms: true, startsWithNot: false });
  });

  it("flags text that opens with an uppercase NOT", () => {
    expect(describeSearchText("NOT jwt").startsWithNot).toBe(true);
    expect(describeSearchText("NOT jwt error").startsWithNot).toBe(true);
    expect(describeSearchText("AND NOT jwt").startsWithNot).toBe(true);
    expect(describeSearchText("(NOT jwt)").startsWithNot).toBe(true);
    expect(describeSearchText("not found").startsWithNot).toBe(false);
    expect(describeSearchText("error NOT timeout").startsWithNot).toBe(false);
    expect(describeSearchText('"NOT jwt"').startsWithNot).toBe(false);
  });
});

describe("query slice searchable-terms state", () => {
  function slice() {
    const scope = effectScope();
    const q = scope.run(() => createQuerySlice()) as ReturnType<typeof createQuerySlice>;
    return { q, dispose: () => scope.stop() };
  }

  it("reports no searchable terms only for typed text that has none", () => {
    const { q, dispose } = slice();
    try {
      expect(q.hasNoSearchableTerms.value).toBe(false);
      q.query.value = "*";
      expect(q.hasNoSearchableTerms.value).toBe(true);
      q.query.value = "!!! type:error";
      expect(q.hasNoSearchableTerms.value).toBe(true);
      // Qualifiers alone browse with filters; that's not an unsearchable query.
      q.query.value = "type:error";
      expect(q.hasNoSearchableTerms.value).toBe(false);
      q.query.value = "greeting";
      expect(q.hasNoSearchableTerms.value).toBe(false);
    } finally {
      dispose();
    }
  });

  it("reports a leading NOT after qualifiers are removed", () => {
    const { q, dispose } = slice();
    try {
      q.query.value = "type:error NOT timeout";
      expect(q.startsWithNot.value).toBe(true);
      expect(q.hasNoSearchableTerms.value).toBe(true);
      q.query.value = "error NOT timeout";
      expect(q.startsWithNot.value).toBe(false);
    } finally {
      dispose();
    }
  });
});
