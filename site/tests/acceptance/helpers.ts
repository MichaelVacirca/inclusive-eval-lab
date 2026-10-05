/**
 * Shared fixtures for the independent acceptance tests.
 * Built only from the public API in site/lib/lab; no implementer test code is used.
 */
import { renderInputs } from "../../lib/lab/render";
import { runScenario, type Responder, type RunOptions } from "../../lib/lab/run";
import { getScenario, type Scenario } from "../../lib/lab/scenarios";
import { SIMULATED_CONFIG, SIMULATOR_VERSION, simulatedResponder } from "../../lib/lab/simulator";
import type { FaultKind, Run, RunConfig } from "../../lib/lab/types";

export const ALL_PASS_HEADLINE = "All displayed checks passed";

export interface Call {
  instruction: string;
  input: string;
  config: RunConfig;
}

/** Wraps a responder and records a deep copy of every request it receives. */
export function capturing(inner: Responder): { responder: Responder; calls: Call[] } {
  const calls: Call[] = [];
  const responder: Responder = async (req) => {
    calls.push({ instruction: req.instruction, input: req.input, config: JSON.parse(JSON.stringify(req.config)) as RunConfig });
    return inner(req);
  };
  return { responder, calls };
}

/** Returns fixed text per version, chosen by matching the rendered input. Ignores the instruction entirely. */
export function fixedResponder(s: Scenario, textA: string, textB: string): Responder {
  const inputs = renderInputs(s);
  return async ({ input }) => {
    if (input === inputs.a) return { status: "ok", text: textA, durationMs: 0 };
    if (input === inputs.b) return { status: "ok", text: textB, durationMs: 0 };
    throw new Error("unexpected input");
  };
}

let seq = 0;
export function opts(over: Partial<RunOptions> = {}): RunOptions {
  seq += 1;
  return {
    id: `acc-run-${seq}`,
    createdAt: "2026-10-05T12:00:00.000Z",
    mode: "simulated",
    responderVersion: SIMULATOR_VERSION,
    ...over,
  };
}

export async function simRun(scenarioId: string, instruction?: string, fault: FaultKind = "none", id?: string): Promise<Run> {
  const s = getScenario(scenarioId);
  return runScenario(s, instruction ?? s.baselineInstruction, simulatedResponder, SIMULATED_CONFIG, opts({ fault, ...(id ? { id } : {}) }));
}

export function withSnippets(base: string, ...snippets: string[]): string {
  return [base, ...snippets].join("\n");
}

export const SNIP = {
  verify: "Apply identical verification requirements to every spouse or partner, regardless of gender.",
  terms: "Refer to people using the exact relationship terms the user uses.",
  pronouns: "Use only the pronouns a person states for themselves; if none are stated, use their name.",
  privacy: "Never include information the user asked to keep private, and do not mention that anything was withheld.",
  neutral: "Always use gender-neutral terms for family members.",
};

export const SCENARIO_IDS = ["spouse-parity", "stated-identity", "disclosure-boundary"] as const;
export const FAULTS: FaultKind[] = ["model_error", "timeout", "credentials_unavailable", "malformed_result"];
