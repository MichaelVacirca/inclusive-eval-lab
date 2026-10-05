import { describe, expect, it } from "vitest";
import { findAnchored, findTerms, mergeSpans } from "../text";

const ANCHORS = ["your", "his", "her", "their"];

describe("findTerms", () => {
  it("matches case-insensitively and returns every match in order", () => {
    const spans = findTerms("Partner bank partner", ["partner"]);
    expect(spans).toHaveLength(2);
    expect(spans.map((s) => s.excerpt)).toEqual(["Partner", "partner"]);
    expect(spans[0]).toEqual({ start: 0, end: 7, excerpt: "Partner" });
    expect(spans[1].start).toBe(13);
  });

  it("respects word boundaries", () => {
    expect(findTerms("transgender", ["trans"])).toEqual([]);
    expect(findTerms("Alexander", ["Alex"])).toEqual([]);
  });

  it("matches multi-word terms across flexible whitespace", () => {
    const text = "a  government-issued   photo ID";
    const spans = findTerms(text, ["photo id"]);
    expect(spans).toHaveLength(1);
    expect(spans[0].excerpt).toBe(text.slice(spans[0].start, spans[0].end));
    expect(spans[0].excerpt).toBe("photo ID");
  });

  it("escapes regex metacharacters in terms", () => {
    expect(findTerms("driver's license here", ["driver's license"])).toHaveLength(1);
    expect(findTerms("a.b", ["a.b"])).toHaveLength(1);
    expect(findTerms("axb", ["a.b"])).toEqual([]);
  });

  it("returns non-overlapping matches sorted by start across several terms", () => {
    const spans = findTerms("Alex Novak and Alex", ["Alex", "Alex Novak", "Novak"]);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end);
    }
    expect(spans.map((s) => s.excerpt)).toEqual(["Alex Novak", "Alex"]);
  });

  it("returns [] for empty text or no terms", () => {
    expect(findTerms("", ["x"])).toEqual([]);
    expect(findTerms("text", [])).toEqual([]);
  });
});

describe("findAnchored", () => {
  it("matches '<anchor> <term>' and covers the whole phrase", () => {
    const spans = findAnchored("To add your partner, Jordan Lee", ["partner"], ANCHORS, "Jordan");
    expect(spans.length).toBeGreaterThanOrEqual(1);
    expect(spans[0].excerpt).toBe("your partner");
  });

  it("does not match an unanchored term", () => {
    expect(findAnchored("our partner bank", ["partner"], ANCHORS, "Jordan")).toEqual([]);
  });

  it("matches '<term>, <name>' and '<term> <name>'", () => {
    expect(findAnchored("husband Jordan is here", ["husband"], ANCHORS, "Jordan")[0].excerpt).toBe("husband Jordan");
    expect(findAnchored("the husband, Jordan", ["husband"], ANCHORS, "Jordan")[0].excerpt).toBe("husband, Jordan");
  });

  it("matches '<name>, <anchor> <term>'", () => {
    const spans = findAnchored("Jordan, your husband, is added", ["husband"], ANCHORS, "Jordan");
    expect(spans).toHaveLength(1);
    expect(spans[0].excerpt).toBe("Jordan, your husband");
  });

  it("returns excerpts equal to the slice of the text", () => {
    const text = "Add YOUR  Husband,  Jordan now";
    for (const s of findAnchored(text, ["husband"], ANCHORS, "Jordan")) {
      expect(text.slice(s.start, s.end)).toBe(s.excerpt);
    }
  });
});

describe("mergeSpans", () => {
  it("sorts and merges overlapping spans", () => {
    expect(
      mergeSpans([
        { start: 0, end: 4 },
        { start: 2, end: 9 },
        { start: 12, end: 14 },
      ]),
    ).toEqual([
      { start: 0, end: 9 },
      { start: 12, end: 14 },
    ]);
  });

  it("merges adjacent spans and handles unsorted input", () => {
    expect(
      mergeSpans([
        { start: 5, end: 8 },
        { start: 0, end: 5 },
      ]),
    ).toEqual([{ start: 0, end: 8 }]);
  });

  it("does not mutate its input", () => {
    const input = [
      { start: 3, end: 4 },
      { start: 0, end: 2 },
    ];
    const copy = JSON.parse(JSON.stringify(input));
    mergeSpans(input);
    expect(input).toEqual(copy);
  });
});
