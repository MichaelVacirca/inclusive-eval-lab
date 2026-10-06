import type {
  TextEvalScenario,
  EvalRunner,
  EvalResult,
  EvalSummary,
  EvalJudge,
  Severity,
} from "./types";

export interface RunEvalOptions {
  scenarioIds?: string[];
  categories?: string[];
  severities?: string[];
  /** Grades each reply instead of the scenario's keyword check. */
  judge?: EvalJudge;
}

export async function runEval(
  runner: EvalRunner,
  scenarios: TextEvalScenario[],
  options?: RunEvalOptions,
): Promise<EvalSummary> {
  let filtered = scenarios;

  if (options?.scenarioIds?.length) {
    const ids = new Set(options.scenarioIds);
    filtered = filtered.filter((s) => ids.has(s.id));
  }
  if (options?.categories?.length) {
    const cats = new Set(options.categories);
    filtered = filtered.filter((s) => cats.has(s.category));
  }
  if (options?.severities?.length) {
    const sevs = new Set(options.severities);
    filtered = filtered.filter((s) => sevs.has(s.severity));
  }

  const results: EvalResult[] = [];

  for (const scenario of filtered) {
    const prompt = runner.systemPrompt
      ? `${runner.systemPrompt}\n\n${scenario.input}`
      : scenario.input;

    const output = await runner.call(prompt);
    const keywordPassed = scenario.pass(output);
    let passed = keywordPassed;
    let judged: Pick<EvalResult, "gradedBy" | "keywordPassed" | "judgeReason"> = {};

    if (options?.judge) {
      const verdict = await options.judge.grade(scenario, output);
      if (verdict) {
        passed = verdict.passed;
        judged = { gradedBy: "judge", keywordPassed, judgeReason: verdict.reason };
      } else {
        judged = {
          gradedBy: "keyword",
          keywordPassed,
          judgeReason: "No judge verdict; the keyword check decided.",
        };
      }
    }

    results.push({
      scenarioId: scenario.id,
      category: scenario.category,
      severity: scenario.severity,
      title: scenario.title,
      description: scenario.description ?? scenario.title,
      passed,
      output,
      failMessage: passed ? undefined : scenario.failMessage,
      patternUrl: scenario.patternUrl,
      ...judged,
    });
  }

  return buildSummary(results);
}

function buildSummary(results: EvalResult[]): EvalSummary {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  const bySeverity: Record<string, { passed: number; failed: number }> = {};
  for (const r of results) {
    if (!bySeverity[r.severity]) {
      bySeverity[r.severity] = { passed: 0, failed: 0 };
    }
    bySeverity[r.severity][r.passed ? "passed" : "failed"]++;
  }

  const byCategory: Record<string, { passed: number; failed: number }> = {};
  for (const r of results) {
    if (!byCategory[r.category]) {
      byCategory[r.category] = { passed: 0, failed: 0 };
    }
    byCategory[r.category][r.passed ? "passed" : "failed"]++;
  }

  const criticalFails = bySeverity["critical"]?.failed ?? 0;
  const highFails = bySeverity["high"]?.failed ?? 0;

  let verdict: EvalSummary["verdict"];
  if (criticalFails > 0) {
    verdict = "FAIL";
  } else if (highFails > 0) {
    verdict = "NEEDS_WORK";
  } else {
    verdict = "PASS";
  }

  return { total: results.length, passed, failed, bySeverity, byCategory, verdict, results };
}
