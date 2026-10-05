/**
 * Core types for the Evaluation Lab.
 * Scenario and CheckDef live in scenarios.ts and are re-exported here.
 */

export type Variant = "a" | "b";
export type ResultVariant = Variant | "pair";
export type CheckStatus = "pass" | "fail" | "inconclusive" | "not_evaluated" | "error";
export type ResultFlag = "unsupported_claim" | "malformed" | "vacuous";
export type Provenance = "user_provided" | "user_provided_restricted" | "system_introduced";

export interface Evidence {
  variant: Variant;
  start: number;
  end: number;
  excerpt: string;
  provenance?: Provenance;
}

export interface CheckResult {
  checkId: string;
  variant: ResultVariant;
  status: CheckStatus;
  evidence: Evidence[];
  rationale: string;
  flags: ResultFlag[];
  omissionTerms?: string[];
}

export type ResponseStatus = "ok" | "model_error" | "timeout" | "credentials_unavailable" | "not_run";

export interface ResponseRecord {
  status: ResponseStatus;
  text?: string;
  error?: string;
  durationMs: number;
  rulesMatched?: string[];
  failureModesApplied?: string[];
}

export interface RunConfig {
  provider: string;
  model: string;
  temperature: number | null;
  maxTokens: number | null;
}

export type RunMode = "simulated" | "live";

export type FaultKind = "none" | "model_error" | "timeout" | "credentials_unavailable" | "malformed_result";

export interface Run {
  id: string;
  createdAt: string;
  mode: RunMode;
  responderVersion: string;
  scenarioId: string;
  scenarioVersion: string;
  rubricVersion: string;
  checksHash: string;
  instruction: string;
  instructionFingerprint: string;
  config: RunConfig;
  inputsSent: { a: string; b: string };
  responses: { a: ResponseRecord; b: ResponseRecord };
  results: CheckResult[];
  validationNotes: string[];
  faultInjected?: FaultKind;
}

export interface Override {
  runId: string;
  scenarioId: string;
  scenarioVersion: string;
  rubricVersion: string;
  instructionFingerprint: string;
  checkId: string;
  variant: ResultVariant;
  automatedStatus: CheckStatus;
  humanStatus: "pass" | "fail" | "inconclusive";
  reason: string;
  createdAt: string;
}

export const CHECK_STATUSES: readonly CheckStatus[] = ["pass", "fail", "inconclusive", "not_evaluated", "error"];
