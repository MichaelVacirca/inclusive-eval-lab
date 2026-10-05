/**
 * REQ 6: comparisons only use compatible scenarios, rubrics, and run configurations.
 * REQ 10: human overrides stay distinct from the original automated judgments.
 * Also REQ 2 (compare step): preset paths reach improved, regressed, and inconclusive rows.
 */
import { describe, expect, it } from "vitest";
import { compareRuns } from "../../lib/lab/compare";
import { scenarioVerdict } from "../../lib/lab/evaluate";
import { countsAfterReview, createOverride, reviewLogJson } from "../../lib/lab/overrides";
import { checksHash, getScenario } from "../../lib/lab/scenarios";
import type { Run } from "../../lib/lab/types";
import { simRun, SNIP, withSnippets } from "./helpers";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("REQ 6: incompatible comparisons are refused with a reason", () => {
  const mutations: Array<[string, (r: Run) => void]> = [
    ["scenarioId", (r) => (r.scenarioId = "stated-identity")],
    ["scenarioVersion", (r) => (r.scenarioVersion = "2")],
    ["rubricVersion", (r) => (r.rubricVersion = "2099-01-01.1")],
    ["checksHash", (r) => (r.checksHash = "fp:deadbeef")],
    ["mode", (r) => (r.mode = "live")],
    ["responderVersion", (r) => (r.responderVersion = "lab-simulator-rules-v2")],
    ["config.provider", (r) => (r.config.provider = "other")],
    ["config.model", (r) => (r.config.model = "other-model")],
    ["config.temperature (null -> 0)", (r) => (r.config.temperature = 0)],
    ["config.maxTokens", (r) => (r.config.maxTokens = 256)],
  ];
  for (const [name, mutate] of mutations) {
    it(`refuses when ${name} differs (both directions)`, async () => {
      const base = await simRun("spouse-parity");
      const other = clone(base);
      other.id = "other";
      mutate(other);
      const c1 = compareRuns(base, other);
      const c2 = compareRuns(other, base);
      expect(c1.compatible).toBe(false);
      expect(c2.compatible).toBe(false);
      if (!c1.compatible) expect(c1.reason.length).toBeGreaterThan(0);
    });
  }

  it("refuses runs from two different real scenarios", async () => {
    const a = await simRun("spouse-parity");
    const b = await simRun("disclosure-boundary");
    expect(compareRuns(a, b).compatible).toBe(false);
  });

  it("checksHash changes when a check's lexicon changes, so an edited rubric cannot be compared silently", () => {
    const s = getScenario("spouse-parity");
    const edited = { ...s, checks: s.checks.map((c, i) => (i === 0 ? { ...c, lexicon: { ...c.lexicon, extra: ["x"] } } : c)) };
    expect(checksHash(edited)).not.toBe(checksHash(s));
  });

  it("accepts two simulated runs of the same scenario with different instructions", async () => {
    const s = getScenario("spouse-parity");
    const c = compareRuns(await simRun(s.id), await simRun(s.id, withSnippets(s.baselineInstruction, SNIP.verify)));
    expect(c.compatible).toBe(true);
    if (c.compatible) expect(c.instructionUnchanged).toBe(false);
  });

  it("flags an unchanged instruction", async () => {
    const c = compareRuns(await simRun("spouse-parity"), await simRun("spouse-parity"));
    expect(c.compatible && c.instructionUnchanged).toBe(true);
  });

  it("a result missing from the later run is inconclusive, not improved or unchanged", async () => {
    const base = await simRun("spouse-parity");
    const later = clone(base);
    later.id = "later";
    later.results = later.results.slice(1);
    const c = compareRuns(base, later);
    expect(c.compatible).toBe(true);
    if (!c.compatible) return;
    const row = c.rows.find((r) => r.checkId === base.results[0].checkId && r.variant === base.results[0].variant)!;
    expect(row.classification).toBe("inconclusive");
  });
});

describe("REQ 2 (compare): preset paths reach improved, regressed, and inconclusive rows", () => {
  it("spouse: FIX-VERIFY + FIX-TERMS improves; OVER-NEUTRAL regresses; a timeout is inconclusive", async () => {
    const s = getScenario("spouse-parity");
    const base = await simRun(s.id);
    const fixed = compareRuns(base, await simRun(s.id, withSnippets(s.baselineInstruction, SNIP.verify, SNIP.terms)));
    const over = compareRuns(base, await simRun(s.id, withSnippets(s.baselineInstruction, SNIP.verify, SNIP.neutral)));
    const timeout = compareRuns(base, await simRun(s.id, undefined, "timeout"));
    expect(fixed.compatible && fixed.summary.improved).toBeGreaterThan(0);
    expect(fixed.compatible && fixed.summary.regressed).toBe(0);
    expect(over.compatible && over.summary.regressed).toBeGreaterThan(0);
    expect(timeout.compatible && timeout.summary.inconclusive).toBeGreaterThan(0);
  });
});

describe("REQ 10: overrides are separate from automated results", () => {
  it("creating an override does not mutate the run, its verdict, or a comparison", async () => {
    const base = await simRun("spouse-parity");
    const later = await simRun("spouse-parity", withSnippets(getScenario("spouse-parity").baselineInstruction, SNIP.verify));
    const snapshot = clone(base);
    const verdictBefore = scenarioVerdict(base.results);
    const cmpBefore = compareRuns(base, later);

    const target = base.results.find((r) => r.status === "fail")!;
    const out = createOverride(base, target, "pass", "I think the extra ID request is policy, not bias.", "2026-10-05T01:00:00Z");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const o = out.override;
    expect(o.automatedStatus).toBe("fail");
    expect(o.humanStatus).toBe("pass");
    expect(o.runId).toBe(base.id);
    expect(o.instructionFingerprint).toBe(base.instructionFingerprint);
    expect(o.reason).toBe("I think the extra ID request is policy, not bias.");

    expect(base).toEqual(snapshot);
    expect(scenarioVerdict(base.results)).toEqual(verdictBefore);
    expect(compareRuns(base, later)).toEqual(cmpBefore);

    const automated = scenarioVerdict(base.results).counts;
    const reviewed = countsAfterReview(base.results, [o], base.id);
    expect(reviewed.fail).toBe(automated.fail - 1);
    expect(reviewed.pass).toBe(automated.pass + 1);
    expect(base).toEqual(snapshot);
  });

  it("an override only applies to its own run", async () => {
    const r1 = await simRun("spouse-parity");
    const r2 = await simRun("spouse-parity");
    const out = createOverride(r1, r1.results.find((r) => r.status === "fail")!, "pass", "reason", "t");
    if (!out.ok) throw new Error(out.error);
    expect(countsAfterReview(r2.results, [out.override], r2.id)).toEqual(scenarioVerdict(r2.results).counts);
  });

  it("the latest override per check wins, and earlier ones remain in the log", async () => {
    const run = await simRun("spouse-parity");
    const t = run.results.find((r) => r.status === "fail")!;
    const o1 = createOverride(run, t, "pass", "first", "t1");
    const o2 = createOverride(run, t, "inconclusive", "second", "t2");
    if (!o1.ok || !o2.ok) throw new Error("override rejected");
    const counts = countsAfterReview(run.results, [o1.override, o2.override], run.id);
    expect(counts.inconclusive).toBe(scenarioVerdict(run.results).counts.inconclusive + 1);
    const log = JSON.parse(reviewLogJson([o1.override, o2.override]));
    expect(log.overrides).toHaveLength(2);
    expect(log.overrides[1]).toMatchObject({ automatedStatus: "fail", humanStatus: "inconclusive", reason: "second" });
  });

  it("requires a valid human verdict and a non-blank reason", async () => {
    const run = await simRun("spouse-parity");
    const t = run.results.find((r) => r.status === "fail")!;
    for (const bad of ["", "PASS", "not_evaluated", "error", "maybe"]) {
      expect(createOverride(run, t, bad, "reason", "t").ok).toBe(false);
    }
    for (const reason of ["", "   ", "\n\t "]) {
      expect(createOverride(run, t, "pass", reason, "t").ok).toBe(false);
    }
  });

  it("is unavailable on not_evaluated and error results", async () => {
    const timed = await simRun("spouse-parity", undefined, "timeout");
    const ne = timed.results.find((r) => r.status === "not_evaluated")!;
    expect(createOverride(timed, ne, "pass", "reason", "t").ok).toBe(false);
    const mal = await simRun("spouse-parity", undefined, "malformed_result");
    const er = mal.results.find((r) => r.status === "error")!;
    expect(createOverride(mal, er, "pass", "reason", "t").ok).toBe(false);
  });

  it("rejects a result that is not part of the run", async () => {
    const run = await simRun("spouse-parity");
    const foreign = { checkId: "s2-pronouns", variant: "a" as const, status: "fail" as const, evidence: [], rationale: "", flags: [] };
    expect(createOverride(run, foreign, "pass", "reason", "t").ok).toBe(false);
  });
});
