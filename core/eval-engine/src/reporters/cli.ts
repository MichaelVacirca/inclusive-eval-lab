import type { EvalReporter, EvalResult, EvalSummary } from "../types";

export class CliReporter implements EvalReporter {
  format = "cli" as const;

  report(results: EvalResult[], summary: EvalSummary): string {
    const lines: string[] = [];

    lines.push("=== @inclusive-ai/eval — LGBTQIA+ Safety Results ===\n");
    lines.push(`${summary.passed}/${summary.total} scenarios passed\n`);

    for (const [sev, counts] of Object.entries(summary.bySeverity)) {
      if (counts.failed > 0) {
        lines.push(`  ${sev.toUpperCase()}: ${counts.failed} failed`);
      }
    }

    const judged = results.filter((r) => r.gradedBy !== undefined);
    if (judged.length > 0) {
      const byJudge = judged.filter((r) => r.gradedBy === "judge");
      const overturnedFails = byJudge.filter((r) => r.passed && r.keywordPassed === false).length;
      const overturnedPasses = byJudge.filter((r) => !r.passed && r.keywordPassed === true).length;
      lines.push(`\nGraded by judge: ${byJudge.length}/${judged.length}`);
      lines.push(`  Keyword failures the judge passed: ${overturnedFails}`);
      lines.push(`  Keyword passes the judge failed: ${overturnedPasses}`);
      if (byJudge.length < judged.length) {
        lines.push(`  No judge verdict, keyword check used: ${judged.length - byJudge.length}`);
      }
    }

    const icon = summary.verdict === "PASS" ? "✅" : summary.verdict === "NEEDS_WORK" ? "⚠️" : "❌";
    lines.push(`\nVerdict: ${icon} ${summary.verdict}\n`);

    const failures = results.filter((r) => !r.passed);
    if (failures.length > 0) {
      lines.push("--- Failures ---\n");
      for (const f of failures) {
        lines.push(`[${f.severity.toUpperCase()}] ${f.scenarioId}: ${f.title}`);
        if (f.failMessage) lines.push(`  → ${f.failMessage}`);
        if (f.judgeReason) lines.push(`  Judge: ${f.judgeReason}`);
        if (f.patternUrl) lines.push(`  → ${f.patternUrl}`);
        lines.push("");
      }

      lines.push("Resources:");
      lines.push("  Patterns: https://inclusive-ai.vercel.app/patterns");
      lines.push("  Checklist: https://inclusive-ai.vercel.app/checklist");
      lines.push("  Registry: https://inclusive-ai.vercel.app/registry");
    }

    return lines.join("\n");
  }
}
