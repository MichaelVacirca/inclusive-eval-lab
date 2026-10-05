import type { CheckStatus, Provenance, ResponseStatus, ResultFlag, ResultVariant, RunMode } from "../../../lib/lab/types";
import type { Scenario } from "../../../lib/lab/scenarios";

/** Visible keyboard focus for every control. */
export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400";

export const BUTTON = `rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;

const ICON: Record<CheckStatus, string> = {
  pass: "✓",
  fail: "✗",
  inconclusive: "?",
  not_evaluated: "—",
  error: "⚠",
};

const LABEL: Record<CheckStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  inconclusive: "Inconclusive",
  not_evaluated: "Not evaluated",
  error: "Error",
};

const COLOR: Record<CheckStatus, string> = {
  pass: "text-emerald-300",
  fail: "text-rose-300",
  inconclusive: "text-amber-300",
  not_evaluated: "text-zinc-300",
  error: "text-zinc-300",
};

export function statusLabel(status: CheckStatus, flags: ResultFlag[] = []): string {
  if (status === "error" && flags.includes("malformed")) return "Evaluator error (malformed) — not evaluated";
  if (status === "error") return "Error — not evaluated";
  if (status === "inconclusive" && flags.includes("unsupported_claim")) return "Inconclusive — unsupported claim";
  if (status === "inconclusive" && flags.includes("vacuous")) return "Inconclusive — response too empty to judge";
  return LABEL[status];
}

export function StatusBadge({ status, flags = [] }: { status: CheckStatus; flags?: ResultFlag[] }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${COLOR[status]}`}>
      <span aria-hidden="true">{ICON[status]}</span>
      <span>{statusLabel(status, flags)}</span>
    </span>
  );
}

export const FLAG_LABEL: Record<ResultFlag, string> = {
  unsupported_claim: "unsupported claim",
  malformed: "malformed result",
  vacuous: "response too empty to judge",
};

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  user_provided: "user provided (the user's own word)",
  user_provided_restricted: "user provided, asked to keep out",
  system_introduced: "system introduced (not the user's word)",
};

export const RESPONSE_STATUS_TEXT: Record<ResponseStatus, string> = {
  ok: "OK",
  model_error: "Model error — not evaluated",
  timeout: "Timed out — not evaluated",
  credentials_unavailable: "Credentials unavailable — not evaluated",
  not_run: "Not run",
};

export function variantLabel(s: Scenario, v: ResultVariant): string {
  if (v === "a") return s.variable.a.label;
  if (v === "b") return s.variable.b.label;
  return "Pair (Version A vs Version B)";
}

export function ModeBadge({ mode }: { mode: RunMode }) {
  return mode === "simulated" ? (
    <span className="inline-block rounded-full border border-sky-400/60 px-2 py-0.5 text-xs font-medium text-sky-300">Simulated</span>
  ) : (
    <span className="inline-block rounded-full border border-zinc-500 px-2 py-0.5 text-xs font-medium text-zinc-300">Live (unavailable)</span>
  );
}
