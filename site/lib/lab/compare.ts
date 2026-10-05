/**
 * Compares two runs check by check. Refuses unless both runs used the same
 * scenario, rubric, checks, mode, responder, and config. Human overrides are
 * never an input here, so they cannot change a classification.
 */
import type { CheckStatus, ResultVariant, Run, RunConfig } from "./types";

export type RowClass = "improved" | "regressed" | "unchanged" | "inconclusive";

export interface CompareRow {
  checkId: string;
  variant: ResultVariant;
  before: CheckStatus;
  after: CheckStatus;
  classification: RowClass;
}

export type Comparison =
  | { compatible: false; reason: string }
  | { compatible: true; instructionUnchanged: boolean; rows: CompareRow[]; summary: Record<RowClass, number> };

function sameConfig(x: RunConfig, y: RunConfig): boolean {
  return x.provider === y.provider && x.model === y.model && x.temperature === y.temperature && x.maxTokens === y.maxTokens;
}

export function classify(before: CheckStatus, after: CheckStatus): RowClass {
  const decided = (s: CheckStatus) => s === "pass" || s === "fail";
  if (!decided(before) || !decided(after)) return "inconclusive";
  if (before === after) return "unchanged";
  return before === "fail" ? "improved" : "regressed";
}

export function compareRuns(before: Run, after: Run): Comparison {
  const fields = ["scenarioId", "scenarioVersion", "rubricVersion", "checksHash", "mode", "responderVersion"] as const;
  for (const f of fields) {
    if (before[f] !== after[f]) {
      return { compatible: false, reason: `${f} differs (${before[f]} vs ${after[f]}).` };
    }
  }
  if (!sameConfig(before.config, after.config)) {
    return { compatible: false, reason: "config differs (provider, model, temperature, or max tokens)." };
  }

  const key = (r: { checkId: string; variant: ResultVariant }) => `${r.checkId}/${r.variant}`;
  const afterByKey = new Map(after.results.map((r) => [key(r), r]));
  const seen = new Set<string>();
  const rows: CompareRow[] = [];
  for (const b of before.results) {
    const k = key(b);
    if (seen.has(k)) continue;
    seen.add(k);
    const a = afterByKey.get(k);
    const afterStatus: CheckStatus = a ? a.status : "error";
    rows.push({ checkId: b.checkId, variant: b.variant, before: b.status, after: afterStatus, classification: classify(b.status, afterStatus) });
  }
  for (const a of after.results) {
    const k = key(a);
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push({ checkId: a.checkId, variant: a.variant, before: "error", after: a.status, classification: "inconclusive" });
  }

  const summary: Record<RowClass, number> = { improved: 0, regressed: 0, unchanged: 0, inconclusive: 0 };
  for (const r of rows) summary[r.classification] += 1;

  return {
    compatible: true,
    instructionUnchanged: before.instructionFingerprint === after.instructionFingerprint && before.instruction === after.instruction,
    rows,
    summary,
  };
}
