import { describe, expect, it } from "vitest";
import { scenarioVerdict } from "../evaluate";
import { countsAfterReview, createOverride, reviewLogJson } from "../overrides";
import { runScenario } from "../run";
import { getScenario } from "../scenarios";
import { SIMULATED_CONFIG, SIMULATOR_VERSION, simulatedResponder } from "../simulator";
import type { Override, Run } from "../types";

const S1 = getScenario("spouse-parity");
const T = "2026-10-05T01:00:00.000Z";

function sim(fault?: "timeout" | "malformed_result"): Promise<Run> {
  return runScenario(S1, S1.baselineInstruction, simulatedResponder, SIMULATED_CONFIG, {
    id: "run-1",
    createdAt: "2026-10-05T00:00:00.000Z",
    mode: "simulated",
    responderVersion: SIMULATOR_VERSION,
    fault,
  });
}

describe("createOverride", () => {
  it("records the human verdict alongside the automated one", async () => {
    const run = await sim();
    const result = run.results.find((r) => r.status === "fail")!;
    const out = createOverride(run, result, "pass", "  The excerpt is a quote of the user.  ", T);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.override).toEqual({
      runId: "run-1",
      scenarioId: "spouse-parity",
      scenarioVersion: "1",
      rubricVersion: run.rubricVersion,
      instructionFingerprint: run.instructionFingerprint,
      checkId: result.checkId,
      variant: result.variant,
      automatedStatus: "fail",
      humanStatus: "pass",
      reason: "The excerpt is a quote of the user.",
      createdAt: T,
    });
  });

  it("requires a non-empty reason", async () => {
    const run = await sim();
    for (const reason of ["", "   \n "]) {
      const out = createOverride(run, run.results[0], "pass", reason, T);
      expect(out.ok).toBe(false);
    }
  });

  it("requires a valid human verdict", async () => {
    const run = await sim();
    for (const v of ["", "maybe", "not_evaluated", "error"]) {
      const out = createOverride(run, run.results[0], v, "reason", T);
      expect(out.ok).toBe(false);
    }
  });

  it("is unavailable on not_evaluated and error results", async () => {
    const timedOut = await sim("timeout");
    const ne = timedOut.results.find((r) => r.status === "not_evaluated")!;
    expect(createOverride(timedOut, ne, "pass", "reason", T).ok).toBe(false);
    const malformed = await sim("malformed_result");
    const err = malformed.results.find((r) => r.status === "error")!;
    expect(createOverride(malformed, err, "pass", "reason", T).ok).toBe(false);
  });

  it("rejects a result that is not part of the run", async () => {
    const run = await sim();
    const foreign = { ...run.results[0], checkId: "other-check" };
    expect(createOverride(run, foreign, "pass", "reason", T).ok).toBe(false);
  });
});

describe("countsAfterReview", () => {
  it("applies the latest override per check and variant to a copy", async () => {
    const run = await sim();
    const before = JSON.parse(JSON.stringify(run.results));
    const failing = run.results.filter((r) => r.status === "fail");
    const o1 = createOverride(run, failing[0], "inconclusive", "first", T);
    const o2 = createOverride(run, failing[0], "pass", "second", T);
    if (!o1.ok || !o2.ok) throw new Error("override failed");
    const overrides: Override[] = [o1.override, o2.override];
    const overridesCopy = JSON.parse(JSON.stringify(overrides));

    const automated = scenarioVerdict(run.results).counts;
    const reviewed = countsAfterReview(run.results, overrides, run.id);
    expect(reviewed.fail).toBe(automated.fail - 1);
    expect(reviewed.pass).toBe(automated.pass + 1);
    expect(reviewed.inconclusive).toBe(automated.inconclusive);

    expect(run.results).toEqual(before);
    expect(overrides).toEqual(overridesCopy);
    expect(scenarioVerdict(run.results).counts).toEqual(automated);
  });

  it("ignores overrides for other runs", async () => {
    const run = await sim();
    const o = createOverride(run, run.results.find((r) => r.status === "fail")!, "pass", "r", T);
    if (!o.ok) throw new Error("override failed");
    const other = { ...o.override, runId: "another-run" };
    expect(countsAfterReview(run.results, [other], run.id)).toEqual(scenarioVerdict(run.results).counts);
  });

  it("ignores an override that targets a not-evaluated result", async () => {
    const run = await sim("timeout");
    const ne = run.results.find((r) => r.status === "not_evaluated")!;
    const forged: Override = {
      runId: run.id,
      scenarioId: run.scenarioId,
      scenarioVersion: run.scenarioVersion,
      rubricVersion: run.rubricVersion,
      instructionFingerprint: run.instructionFingerprint,
      checkId: ne.checkId,
      variant: ne.variant,
      automatedStatus: "not_evaluated",
      humanStatus: "pass",
      reason: "forged",
      createdAt: T,
    };
    expect(countsAfterReview(run.results, [forged], run.id)).toEqual(scenarioVerdict(run.results).counts);
  });
});

describe("reviewLogJson", () => {
  it("wraps overrides in a versioned format", async () => {
    const run = await sim();
    const o = createOverride(run, run.results[0], "fail", "reason", T);
    if (!o.ok) throw new Error("override failed");
    const json = reviewLogJson([o.override]);
    expect(JSON.parse(json)).toEqual({ format: "inclusive-lab-review-log/v1", overrides: [o.override] });
    expect(json).toBe(JSON.stringify({ format: "inclusive-lab-review-log/v1", overrides: [o.override] }, null, 2));
  });
});
