import { describe, expect, it } from "vitest";
import { compareRuns } from "../compare";
import { createOverride } from "../overrides";
import { runScenario } from "../run";
import { getScenario } from "../scenarios";
import { SIMULATED_CONFIG, SIMULATOR_VERSION, simulatedResponder, SNIPPET_RULES } from "../simulator";
import type { CheckResult, CheckStatus, Run } from "../types";

const snippet = (id: string) => SNIPPET_RULES.find((x) => x.id === id)!.snippet;
const S1 = getScenario("spouse-parity");
const S3 = getScenario("disclosure-boundary");

function sim(id: string, s = S1, instruction = s.baselineInstruction): Promise<Run> {
  return runScenario(s, instruction, simulatedResponder, SIMULATED_CONFIG, {
    id,
    createdAt: "2026-10-05T00:00:00.000Z",
    mode: "simulated",
    responderVersion: SIMULATOR_VERSION,
  });
}

function withStatuses(run: Run, statuses: CheckStatus[]): Run {
  return { ...run, results: run.results.map((r, i): CheckResult => ({ ...r, status: statuses[i] })) };
}

describe("compareRuns", () => {
  it("classifies improved, regressed, unchanged, and inconclusive", async () => {
    const base = await sim("x");
    // s1 has three results: doc-parity/pair, term-preserved/a, term-preserved/b
    const before = withStatuses(base, ["fail", "pass", "pass"]);
    const after = withStatuses({ ...base, id: "y" }, ["pass", "fail", "pass"]);
    const c = compareRuns(before, after);
    if (!c.compatible) throw new Error(c.reason);
    expect(c.rows.map((r) => r.classification)).toEqual(["improved", "regressed", "unchanged"]);
    const c2 = compareRuns(withStatuses(base, ["inconclusive", "pass", "fail"]), withStatuses(base, ["pass", "not_evaluated", "fail"]));
    if (!c2.compatible) throw new Error(c2.reason);
    expect(c2.rows.map((r) => r.classification)).toEqual(["inconclusive", "inconclusive", "unchanged"]);
    expect(c2.summary).toEqual({ improved: 0, regressed: 0, unchanged: 1, inconclusive: 2 });
  });

  it("reaches improved, regressed, and inconclusive rows through preset paths", async () => {
    const s1base = await sim("b1");
    const s1fixed = await sim("r1", S1, [S1.baselineInstruction, snippet("FIX-VERIFY"), snippet("FIX-TERMS")].join("\n"));
    const c1 = compareRuns(s1base, s1fixed);
    if (!c1.compatible) throw new Error(c1.reason);
    expect(c1.summary.improved).toBeGreaterThan(0);

    const s1over = await sim("r2", S1, [S1.baselineInstruction, snippet("OVER-NEUTRAL")].join("\n"));
    const c2 = compareRuns(s1base, s1over);
    if (!c2.compatible) throw new Error(c2.reason);
    expect(c2.summary.regressed).toBeGreaterThan(0);
    expect(c2.instructionUnchanged).toBe(false);

    const s3base = await sim("b3", S3);
    const s3fixed = await sim("r3", S3, [S3.baselineInstruction, snippet("FIX-PRIVACY")].join("\n"));
    const c3 = compareRuns(s3base, s3fixed);
    if (!c3.compatible) throw new Error(c3.reason);
    expect(c3.summary.inconclusive).toBeGreaterThan(0);
    expect(c3.summary.improved).toBeGreaterThan(0);
  });

  it("an unchanged instruction is flagged and nothing improves or regresses", async () => {
    const a = await sim("a");
    const b = await sim("b");
    const c = compareRuns(a, b);
    if (!c.compatible) throw new Error(c.reason);
    expect(c.instructionUnchanged).toBe(true);
    expect(c.summary.improved).toBe(0);
    expect(c.summary.regressed).toBe(0);
  });

  it("refuses when any compatibility field differs, naming the field", async () => {
    const base = await sim("x");
    const cases: Array<[string, Partial<Run>]> = [
      ["scenarioId", { scenarioId: "other" }],
      ["scenarioVersion", { scenarioVersion: "2" }],
      ["rubricVersion", { rubricVersion: "old" }],
      ["checksHash", { checksHash: "fp:00000000" }],
      ["mode", { mode: "live" }],
      ["responderVersion", { responderVersion: "other" }],
      ["config", { config: { ...base.config, temperature: 0.7 } }],
      ["config", { config: { ...base.config, model: "other" } }],
    ];
    for (const [field, patch] of cases) {
      const c = compareRuns(base, { ...base, ...patch });
      expect(c.compatible).toBe(false);
      if (!c.compatible) expect(c.reason).toContain(field);
    }
  });

  it("refuses to compare simulated and live runs", async () => {
    const base = await sim("x");
    const c = compareRuns(base, { ...base, mode: "live", responderVersion: "live-stub-v1" });
    expect(c.compatible).toBe(false);
  });

  it("overrides never alter the comparison", async () => {
    const before = await sim("b1");
    const after = await sim("r1", S1, [S1.baselineInstruction, snippet("FIX-VERIFY"), snippet("FIX-TERMS")].join("\n"));
    const plain = compareRuns(before, after);
    const created = createOverride(before, before.results[1], "fail", "I disagree", "2026-10-05T01:00:00.000Z");
    expect(created.ok).toBe(true);
    expect(compareRuns(before, after)).toEqual(plain);
  });
});
