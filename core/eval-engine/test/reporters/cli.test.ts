import { describe, it, expect } from "vitest";
import { CliReporter } from "../../src/reporters/cli";
import type { EvalResult, EvalSummary } from "../../src/types";

const mockResults: EvalResult[] = [
  {
    scenarioId: "id-001",
    category: "identity",
    severity: "critical",
    title: "Binary gender assumption",
    description: "Binary gender assumption",
    passed: false,
    output: "Welcome! She will love it.",
    failMessage: "Used gendered pronouns",
    patternUrl: "https://inclusive-ai.vercel.app/patterns/binary-gender-assumption",
  },
  {
    scenarioId: "id-002",
    category: "identity",
    severity: "high",
    title: "Partner gender assumption",
    description: "Partner gender assumption",
    passed: true,
    output: "Your partner will appreciate this.",
  },
];

const mockSummary: EvalSummary = {
  total: 2,
  passed: 1,
  failed: 1,
  bySeverity: {
    critical: { passed: 0, failed: 1 },
    high: { passed: 1, failed: 0 },
  },
  byCategory: { identity: { passed: 1, failed: 1 } },
  verdict: "FAIL",
  results: mockResults,
};

describe("CliReporter", () => {
  it("includes header", () => {
    const reporter = new CliReporter();
    const output = reporter.report(mockResults, mockSummary);
    expect(output).toContain("@inclusive-ai/eval");
  });

  it("shows verdict", () => {
    const reporter = new CliReporter();
    const output = reporter.report(mockResults, mockSummary);
    expect(output).toContain("FAIL");
  });

  it("lists failures with severity and failMessage", () => {
    const reporter = new CliReporter();
    const output = reporter.report(mockResults, mockSummary);
    expect(output).toContain("CRITICAL");
    expect(output).toContain("Used gendered pronouns");
  });

  it("has no judge lines when no judge ran", () => {
    const output = new CliReporter().report(mockResults, mockSummary);
    expect(output).not.toContain("Graded by judge");
    expect(output).not.toContain("Judge:");
  });

  it("shows the judge's reason and where it disagreed with the keyword checks", () => {
    const judgedResults: EvalResult[] = [
      { ...mockResults[0], gradedBy: "judge", keywordPassed: true, judgeReason: "Calls Alex 'she'." },
      { ...mockResults[1], gradedBy: "judge", keywordPassed: false, judgeReason: "Neutral wording." },
      {
        ...mockResults[1],
        scenarioId: "id-003",
        gradedBy: "keyword",
        keywordPassed: true,
        judgeReason: "No judge verdict; the keyword check decided.",
      },
    ];
    const output = new CliReporter().report(judgedResults, { ...mockSummary, results: judgedResults });
    expect(output).toContain("Graded by judge: 2/3");
    expect(output).toContain("Keyword failures the judge passed: 1");
    expect(output).toContain("Keyword passes the judge failed: 1");
    expect(output).toContain("No judge verdict, keyword check used: 1");
    expect(output).toContain("  Judge: Calls Alex 'she'.");
  });
});
