/**
 * Human review: a separate list of overrides. Automated results, the
 * headline, and comparisons are never changed by an override.
 */
import { countStatuses } from "./evaluate";
import type { CheckResult, CheckStatus, Override, Run } from "./types";

const HUMAN_STATUSES = ["pass", "fail", "inconclusive"] as const;
type HumanStatus = (typeof HUMAN_STATUSES)[number];

export function canOverride(result: CheckResult): boolean {
  return result.status !== "not_evaluated" && result.status !== "error";
}

export function createOverride(
  run: Run,
  result: CheckResult,
  humanStatus: string,
  reason: string,
  createdAt: string,
): { ok: true; override: Override } | { ok: false; error: string } {
  if (!canOverride(result)) {
    return { ok: false, error: "Human review is unavailable for results that were not evaluated or had an evaluator error." };
  }
  if (!(HUMAN_STATUSES as readonly string[]).includes(humanStatus)) {
    return { ok: false, error: "Choose a human verdict: Pass, Fail, or Inconclusive." };
  }
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "A reason is required." };
  }
  const inRun = run.results.some((r) => r.checkId === result.checkId && r.variant === result.variant && r.status === result.status);
  if (!inRun) {
    return { ok: false, error: "This result is not part of the selected run." };
  }
  return {
    ok: true,
    override: {
      runId: run.id,
      scenarioId: run.scenarioId,
      scenarioVersion: run.scenarioVersion,
      rubricVersion: run.rubricVersion,
      instructionFingerprint: run.instructionFingerprint,
      checkId: result.checkId,
      variant: result.variant,
      automatedStatus: result.status,
      humanStatus: humanStatus as HumanStatus,
      reason: trimmed,
      createdAt,
    },
  };
}

/** The latest override per (checkId, variant) for one run, in list order. */
export function latestOverrides(overrides: Override[], runId: string): Map<string, Override> {
  const out = new Map<string, Override>();
  for (const o of overrides) {
    if (o.runId === runId) out.set(`${o.checkId}/${o.variant}`, o);
  }
  return out;
}

/** Counts with the latest override applied to a copy of each result. Inputs are never mutated. */
export function countsAfterReview(results: CheckResult[], overrides: Override[], runId: string): Record<CheckStatus, number> {
  const latest = latestOverrides(overrides, runId);
  const reviewed = results.map((r) => {
    const o = latest.get(`${r.checkId}/${r.variant}`);
    return { status: o && canOverride(r) ? (o.humanStatus as CheckStatus) : r.status };
  });
  return countStatuses(reviewed);
}

export function reviewLogJson(overrides: Override[]): string {
  return JSON.stringify({ format: "inclusive-lab-review-log/v1", overrides }, null, 2);
}
