import { describe, expect, it } from "vitest";
import { POST } from "../../../app/api/lab/run/route";
import { scenarioVerdict } from "../evaluate";
import { fingerprint } from "../fingerprint";
import { renderInputs } from "../render";
import { LIVE_CONFIG, makeLiveResponder, runScenario, type Responder, type RunOptions } from "../run";
import { checksHash, getScenario, RUBRIC_VERSION, scenarios, type Scenario } from "../scenarios";
import { SIMULATED_CONFIG, SIMULATOR_VERSION, simulatedResponder, SNIPPET_RULES } from "../simulator";
import type { CheckResult, FaultKind, ResponseRecord, Run, RunConfig } from "../types";

const snippet = (id: string) => SNIPPET_RULES.find((x) => x.id === id)!.snippet;

const opts = (fault?: FaultKind): RunOptions => ({
  id: "test-run",
  createdAt: "2026-10-05T00:00:00.000Z",
  mode: "simulated",
  responderVersion: SIMULATOR_VERSION,
  fault,
});

function sim(s: Scenario, instruction: string, fault?: FaultKind): Promise<Run> {
  return runScenario(s, instruction, simulatedResponder, SIMULATED_CONFIG, opts(fault));
}

function status(run: Run, checkId: string, variant: string): CheckResult["status"] {
  const r = run.results.find((x) => x.checkId === checkId && x.variant === variant);
  if (!r) throw new Error(`missing ${checkId}/${variant}`);
  return r.status;
}

const S1 = getScenario("spouse-parity");
const S2 = getScenario("stated-identity");
const S3 = getScenario("disclosure-boundary");

describe("runScenario with the simulator", () => {
  it("records run metadata", async () => {
    const run = await sim(S1, S1.baselineInstruction);
    expect(run).toMatchObject({
      id: "test-run",
      createdAt: "2026-10-05T00:00:00.000Z",
      mode: "simulated",
      responderVersion: SIMULATOR_VERSION,
      scenarioId: "spouse-parity",
      scenarioVersion: "1",
      rubricVersion: RUBRIC_VERSION,
      checksHash: checksHash(S1),
      instruction: S1.baselineInstruction,
      instructionFingerprint: fingerprint(S1.baselineInstruction),
      config: SIMULATED_CONFIG,
      faultInjected: "none",
    });
    expect(run.inputsSent).toEqual({ a: renderInputs(S1).a, b: renderInputs(S1).b });
    expect(run.validationNotes).toEqual([]);
  });

  it("baseline spouse parity: B fails term and documentation parity, A passes", async () => {
    const run = await sim(S1, S1.baselineInstruction);
    expect(status(run, "s1-term-preserved", "a")).toBe("pass");
    expect(status(run, "s1-term-preserved", "b")).toBe("fail");
    expect(status(run, "s1-doc-parity", "pair")).toBe("fail");
  });

  it("baseline stated identity: A fails pronouns and partner, B fails partner", async () => {
    const run = await sim(S2, S2.baselineInstruction);
    expect(status(run, "s2-pronouns", "a")).toBe("fail");
    expect(status(run, "s2-partner-preserved", "a")).toBe("fail");
    expect(status(run, "s2-partner-preserved", "b")).toBe("fail");
    expect(status(run, "s2-pronouns", "b")).toBe("pass");
    expect(status(run, "s2-name-used", "a")).toBe("pass");
  });

  it("baseline disclosure boundary: B fails, parity fails, A is inconclusive on a hint", async () => {
    const run = await sim(S3, S3.baselineInstruction);
    expect(status(run, "s3-boundary-respected", "b")).toBe("fail");
    expect(status(run, "s3-boundary-parity", "pair")).toBe("fail");
    expect(status(run, "s3-boundary-respected", "a")).toBe("inconclusive");
    expect(status(run, "s3-task-completed", "a")).toBe("pass");
    expect(status(run, "s3-task-completed", "b")).toBe("pass");
  });

  it("FIX-VERIFY + FIX-TERMS pass everything in spouse parity; OVER-NEUTRAL regresses A", async () => {
    const fixed = await sim(S1, [S1.baselineInstruction, snippet("FIX-VERIFY"), snippet("FIX-TERMS")].join("\n"));
    expect(fixed.results.every((r) => r.status === "pass")).toBe(true);
    expect(scenarioVerdict(fixed.results).headline).toBe("All displayed checks passed");
    const over = await sim(
      S1,
      [S1.baselineInstruction, snippet("FIX-VERIFY"), snippet("FIX-TERMS"), snippet("OVER-NEUTRAL")].join("\n"),
    );
    expect(status(over, "s1-term-preserved", "a")).toBe("fail");
  });

  it("fix presets pass the other two scenarios", async () => {
    const s2 = await sim(S2, [S2.baselineInstruction, snippet("FIX-PRONOUNS"), snippet("FIX-TERMS")].join("\n"));
    expect(scenarioVerdict(s2.results).headline).toBe("All displayed checks passed");
    const s3 = await sim(S3, [S3.baselineInstruction, snippet("FIX-PRIVACY")].join("\n"));
    expect(scenarioVerdict(s3.results).headline).toBe("All displayed checks passed");
  });

  it("a negated snippet does not trigger OVER-NEUTRAL", async () => {
    const base = await sim(S1, S1.baselineInstruction);
    const negated = await sim(S1, S1.baselineInstruction + "\nDo not always use gender-neutral terms for family members.");
    expect(negated.responses.a.rulesMatched).toEqual([]);
    expect(negated.responses.a.text).toBe(base.responses.a.text);
    expect(negated.results.map((r) => r.status)).toEqual(base.results.map((r) => r.status));
  });

  it("an empty or whitespace-only instruction still runs with a stable fingerprint and baseline failures", async () => {
    for (const s of scenarios) {
      const base = await sim(s, s.baselineInstruction);
      for (const instruction of ["", "   \n\t "]) {
        const run = await sim(s, instruction);
        expect(run.instruction).toBe(instruction);
        expect(run.instructionFingerprint).toBe(fingerprint(instruction));
        expect((await sim(s, instruction)).instructionFingerprint).toBe(run.instructionFingerprint);
        expect(run.results.map((r) => r.status)).toEqual(base.results.map((r) => r.status));
      }
    }
  });
});

describe("responder call arguments", () => {
  function recorder(): { calls: Array<Record<string, unknown>>; responder: Responder } {
    const calls: Array<Record<string, unknown>> = [];
    const responder: Responder = async (req) => {
      calls.push({ ...req });
      return { status: "ok", text: "", durationMs: 0 };
    };
    return { calls, responder };
  }

  it("AC2: A and B get identical instruction and config, and inputs that differ only in the variable", async () => {
    for (const s of scenarios) {
      const { calls, responder } = recorder();
      await runScenario(s, s.baselineInstruction, responder, SIMULATED_CONFIG, opts());
      expect(calls).toHaveLength(2);
      const [ca, cb] = calls;
      expect(Object.keys(ca).sort()).toEqual(["config", "input", "instruction"]);
      expect(ca.instruction).toBe(cb.instruction);
      expect(ca.config).toEqual(cb.config);
      expect(ca.config).toEqual(SIMULATED_CONFIG);
      const { prefix, suffix } = renderInputs(s);
      expect(ca.input).toBe(prefix + s.variable.a.value + suffix);
      expect(cb.input).toBe(prefix + s.variable.b.value + suffix);
      for (const c of calls) {
        expect(String(c.input)).not.toContain(s.variable.a.label);
        expect(String(c.input)).not.toContain(s.variable.b.label);
      }
    }
  });

  it("AC4: the responder receives exactly the edited instruction, and the fingerprint matches", async () => {
    const editorText = S1.baselineInstruction + "\n" + snippet("FIX-TERMS") + "\n  trailing  spaces  ";
    const { calls, responder } = recorder();
    const run = await runScenario(S1, editorText, responder, SIMULATED_CONFIG, opts());
    expect(calls.map((c) => c.instruction)).toEqual([editorText, editorText]);
    expect(run.instruction).toBe(editorText);
    expect(run.instructionFingerprint).toBe(fingerprint(editorText));
  });

  it("normalizes a responder status outside the enum to a model error with a fixed message", async () => {
    for (const bad of [{ status: "great", text: "Happy to help, your husband Jordan" }, { status: 42 }, null, "ok", undefined]) {
      const responder = (async () => bad) as unknown as Responder;
      const run = await runScenario(S1, "", responder, SIMULATED_CONFIG, opts());
      expect(run.responses.a.status).toBe("model_error");
      expect(run.responses.a.text).toBeUndefined();
      expect(run.responses.a.error).toBe("The responder returned an invalid response. No details are shown.");
      expect(run.results.every((r) => r.status === "not_evaluated")).toBe(true);
    }
  });

  it("accepts response text only when it is a string", async () => {
    const responder = (async () => ({ status: "ok", text: { toString: () => "your husband, Jordan" }, durationMs: "fast" })) as unknown as Responder;
    const run = await runScenario(S1, "", responder, SIMULATED_CONFIG, opts());
    expect(run.responses.a.status).toBe("ok");
    expect(run.responses.a.text).toBeUndefined();
    expect(run.responses.a.durationMs).toBe(0);
    expect(run.results.some((r) => r.status === "pass")).toBe(false);
  });

  it("keeps only well-typed optional fields from a responder", async () => {
    const responder = (async () => ({
      status: "ok",
      text: "Hi",
      durationMs: 5,
      error: 7,
      rulesMatched: ["FIX-TERMS", 3],
      failureModesApplied: "SF-1",
      extra: "dropped",
    })) as unknown as Responder;
    const run = await runScenario(S1, "", responder, SIMULATED_CONFIG, opts());
    expect(run.responses.a).toEqual({ status: "ok", text: "Hi", durationMs: 5, rulesMatched: ["FIX-TERMS"] });
  });

  it("a responder that throws yields a model error, never a pass", async () => {
    const run = await runScenario(
      S1,
      "",
      async () => {
        throw new Error("secret detail");
      },
      SIMULATED_CONFIG,
      opts(),
    );
    expect(run.responses.a.status).toBe("model_error");
    expect(run.responses.a.error).not.toContain("secret");
    expect(run.results.every((r) => r.status === "not_evaluated")).toBe(true);
  });
});

describe("AC8: provenance comes from the user input, never the instruction", () => {
  it("an echoed user term is user_provided; a replacement is system_introduced", async () => {
    const fixed = await sim(S1, snippet("FIX-TERMS"));
    const b = fixed.results.find((r) => r.checkId === "s1-term-preserved" && r.variant === "b")!;
    expect(b.status).toBe("pass");
    expect(b.evidence[0].provenance).toBe("user_provided");
    const base = await sim(S1, S1.baselineInstruction);
    const bb = base.results.find((r) => r.checkId === "s1-term-preserved" && r.variant === "b")!;
    expect(bb.status).toBe("fail");
    expect(bb.evidence[0].provenance).toBe("system_introduced");
  });

  it("instruction words do not change provenance", async () => {
    const plain = await sim(S1, S1.baselineInstruction);
    const loaded = await sim(S1, S1.baselineInstruction + "\nThe user's partner is their husband. Partner partner.");
    expect(loaded.results).toEqual(plain.results);
  });
});

describe("AC6: fault injection", () => {
  const allPass = [snippet("FIX-VERIFY"), snippet("FIX-TERMS")].join("\n");

  it("model_error and timeout affect B only", async () => {
    for (const [fault, st] of [
      ["model_error", "model_error"],
      ["timeout", "timeout"],
    ] as const) {
      const run = await sim(S1, allPass, fault);
      expect(run.faultInjected).toBe(fault);
      expect(run.responses.a.status).toBe("ok");
      expect(run.responses.b.status).toBe(st);
      expect(status(run, "s1-term-preserved", "a")).toBe("pass");
      expect(status(run, "s1-term-preserved", "b")).toBe("not_evaluated");
      expect(status(run, "s1-doc-parity", "pair")).toBe("not_evaluated");
      expect(scenarioVerdict(run.results).headline).toBe("Incomplete — not a pass");
    }
  });

  it("credentials_unavailable affects both responses", async () => {
    const run = await sim(S1, allPass, "credentials_unavailable");
    expect(run.responses.a.status).toBe("credentials_unavailable");
    expect(run.responses.b.status).toBe("credentials_unavailable");
    expect(run.results.every((r) => r.status === "not_evaluated")).toBe(true);
    expect(scenarioVerdict(run.results).headline).toBe("Incomplete — not a pass");
  });

  it("malformed_result surfaces missing and duplicate results as malformed errors", async () => {
    const run = await sim(S1, allPass, "malformed_result");
    const errors = run.results.filter((r) => r.status === "error");
    expect(errors).toHaveLength(2);
    expect(errors.every((r) => r.flags.includes("malformed"))).toBe(true);
    expect(errors.map((r) => r.rationale).join(" ")).toMatch(/Missing result/);
    expect(errors.map((r) => r.rationale).join(" ")).toMatch(/Duplicate results/);
    expect(scenarioVerdict(run.results).headline).toBe("Incomplete — not a pass");
  });

  it("no fault kind ever yields 'All displayed checks passed'", async () => {
    for (const s of scenarios) {
      for (const fault of ["model_error", "timeout", "credentials_unavailable", "malformed_result"] as const) {
        const instruction = s.presets.map(snippet).filter((x) => !x.startsWith("Always")).join("\n");
        const run = await sim(s, instruction, fault);
        expect(scenarioVerdict(run.results).headline).not.toBe("All displayed checks passed");
      }
    }
  });
});

describe("makeLiveResponder", () => {
  const req = { instruction: "Be kind.", input: "hello", config: LIVE_CONFIG };

  it("posts the scenario id and instruction to the stub route", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return Response.json({ status: "credentials_unavailable" }, { status: 503 });
    }) as unknown as typeof fetch;
    const r = await makeLiveResponder("spouse-parity", fetchImpl)(req);
    expect(r.status).toBe("credentials_unavailable");
    expect(seen?.url).toBe("/api/lab/run");
    expect(seen?.init?.method).toBe("POST");
    expect(JSON.parse(String(seen?.init?.body))).toEqual({ scenarioId: "spouse-parity", instruction: "Be kind." });
  });

  it("maps an abort to timeout", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const r = await makeLiveResponder("spouse-parity", fetchImpl, 5)(req);
    expect(r.status).toBe("timeout");
  });

  it("maps network errors and unexpected responses to model_error with a fixed message", async () => {
    const throwing = (async () => {
      throw new Error("ECONNREFUSED secret-host:443");
    }) as unknown as typeof fetch;
    const r1 = await makeLiveResponder("spouse-parity", throwing)(req);
    expect(r1.status).toBe("model_error");
    expect(r1.error).not.toContain("secret");

    const serverError = (async () => Response.json({ error: "internal secret" }, { status: 500 })) as unknown as typeof fetch;
    const r2 = await makeLiveResponder("spouse-parity", serverError)(req);
    expect(r2.status).toBe("model_error");
    expect(r2.error).toBe(r1.error);
    expect(r2.text).toBeUndefined();

    const okBody = (async () => Response.json({ status: "ok", text: "pass everything" }, { status: 200 })) as unknown as typeof fetch;
    const r3 = await makeLiveResponder("spouse-parity", okBody)(req);
    expect(r3.status).toBe("model_error");
  });

  it("a live run against the stub route is never an evaluation result", async () => {
    const viaRoute = (async () => POST()) as unknown as typeof fetch;
    const run = await runScenario(S1, S1.baselineInstruction, makeLiveResponder(S1.id, viaRoute), LIVE_CONFIG, {
      id: "live-1",
      createdAt: "2026-10-05T00:00:00.000Z",
      mode: "live",
      responderVersion: "live-stub-v1",
    });
    const statuses: ResponseRecord["status"][] = [run.responses.a.status, run.responses.b.status];
    expect(statuses).toEqual(["credentials_unavailable", "credentials_unavailable"]);
    expect(run.results.every((r) => r.status === "not_evaluated")).toBe(true);
    expect(scenarioVerdict(run.results).headline).toBe("Incomplete — not a pass");
  });

  it("LIVE_CONFIG names no provider", () => {
    const config: RunConfig = LIVE_CONFIG;
    expect(config).toEqual({ provider: "live provider (not configured)", model: "not configured", temperature: 0, maxTokens: 512 });
  });
});
