/**
 * Run orchestration: render the paired inputs, call the responder once per
 * variant with the same instruction and config, apply any injected fault,
 * evaluate, and validate.
 */
import { evaluate, validateResults } from "./evaluate";
import { fingerprint } from "./fingerprint";
import { renderInputs } from "./render";
import { checksHash, RUBRIC_VERSION, type Scenario } from "./scenarios";
import type { FaultKind, ResponseRecord, ResponseStatus, Run, RunConfig, RunMode } from "./types";

export type Responder = (req: { instruction: string; input: string; config: RunConfig }) => Promise<ResponseRecord>;

export interface RunOptions {
  id: string;
  createdAt: string;
  mode: RunMode;
  responderVersion: string;
  fault?: FaultKind;
}

export const LIVE_CONFIG: RunConfig = {
  provider: "live provider (not configured)",
  model: "not configured",
  temperature: 0,
  maxTokens: 512,
};

export const LIVE_RESPONDER_VERSION = "live-stub-v1";

const RESPONDER_FAILED = "The responder failed. No details are shown.";
const RESPONDER_INVALID = "The responder returned an invalid response. No details are shown.";
const LIVE_FAILED = "The live route returned an unexpected response. No details are shown.";

const RESPONSE_STATUSES: readonly ResponseStatus[] = ["ok", "model_error", "timeout", "credentials_unavailable", "not_run"];

function stringList(x: unknown): string[] | undefined {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : undefined;
}

/** Rebuilds a ResponseRecord from whatever a responder returned, keeping only well-typed fields. */
export function normalizeResponse(raw: unknown): ResponseRecord {
  if (typeof raw !== "object" || raw === null) return { status: "model_error", error: RESPONDER_INVALID, durationMs: 0 };
  const r = raw as Record<string, unknown>;
  if (typeof r.status !== "string" || !(RESPONSE_STATUSES as readonly string[]).includes(r.status)) {
    return { status: "model_error", error: RESPONDER_INVALID, durationMs: 0 };
  }
  const out: ResponseRecord = {
    status: r.status as ResponseStatus,
    durationMs: typeof r.durationMs === "number" && Number.isFinite(r.durationMs) && r.durationMs >= 0 ? r.durationMs : 0,
  };
  if (typeof r.text === "string") out.text = r.text;
  if (typeof r.error === "string") out.error = r.error;
  const rules = stringList(r.rulesMatched);
  if (rules) out.rulesMatched = rules;
  const modes = stringList(r.failureModesApplied);
  if (modes) out.failureModesApplied = modes;
  return out;
}

async function callSafely(responder: Responder, instruction: string, input: string, config: RunConfig): Promise<ResponseRecord> {
  let raw: unknown;
  try {
    raw = await responder({ instruction, input, config: { ...config } });
  } catch {
    return { status: "model_error", error: RESPONDER_FAILED, durationMs: 0 };
  }
  return normalizeResponse(raw);
}

function injected(status: ResponseRecord["status"], label: string): ResponseRecord {
  return { status, error: `Injected fault (simulated): ${label}.`, durationMs: 0 };
}

export async function runScenario(
  s: Scenario,
  instruction: string,
  responder: Responder,
  config: RunConfig,
  opts: RunOptions,
): Promise<Run> {
  const inputs = renderInputs(s);
  const fault: FaultKind = opts.fault ?? "none";

  // Two independent calls with the identical instruction and config.
  let [a, b] = await Promise.all([
    callSafely(responder, instruction, inputs.a, config),
    callSafely(responder, instruction, inputs.b, config),
  ]);

  if (fault === "model_error") b = injected("model_error", "model error");
  if (fault === "timeout") b = injected("timeout", "timed out");
  if (fault === "credentials_unavailable") {
    a = injected("credentials_unavailable", "credentials unavailable");
    b = injected("credentials_unavailable", "credentials unavailable");
  }

  const responses = { a, b };
  let raw: unknown[] = evaluate(s, responses);
  if (fault === "malformed_result" && raw.length >= 2) {
    // Drop the first result and duplicate the second.
    raw = [raw[1], raw[1], ...raw.slice(2)];
  }
  const { results, notes } = validateResults(s, responses, raw);

  return {
    id: opts.id,
    createdAt: opts.createdAt,
    mode: opts.mode,
    responderVersion: opts.responderVersion,
    scenarioId: s.id,
    scenarioVersion: s.version,
    rubricVersion: RUBRIC_VERSION,
    checksHash: checksHash(s),
    instruction,
    instructionFingerprint: fingerprint(instruction),
    config: { ...config },
    inputsSent: { a: inputs.a, b: inputs.b },
    responses,
    results,
    validationNotes: notes,
    faultInjected: fault,
  };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/**
 * Client-side responder for the live route. The route is a stub in this
 * version, so the only non-error outcome is credentials_unavailable.
 * Raw error text is never forwarded.
 */
export function makeLiveResponder(scenarioId: string, fetchImpl?: typeof fetch, timeoutMs = 15000): Responder {
  return async ({ instruction }) => {
    const doFetch = fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch("/api/lab/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioId, instruction }),
        signal: controller.signal,
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (res.status === 503 && isRecord(body) && body.status === "credentials_unavailable") {
        return { status: "credentials_unavailable", error: "Live mode is not configured on this deployment.", durationMs: 0 };
      }
      return { status: "model_error", error: LIVE_FAILED, durationMs: 0 };
    } catch {
      if (controller.signal.aborted) {
        return { status: "timeout", error: "The live route did not respond in time.", durationMs: timeoutMs };
      }
      return { status: "model_error", error: LIVE_FAILED, durationMs: 0 };
    } finally {
      clearTimeout(timer);
    }
  };
}
