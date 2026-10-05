/**
 * Runs the rubric over a pair of responses, validates the results against the
 * expected set, and computes the scenario verdict. Validation never upgrades a
 * result: it can only turn a claim into inconclusive or error.
 */
import { renderInputs } from "./render";
import type { CheckDef, CheckOutcome, Scenario } from "./scenarios";
import { findTerms } from "./text";
import {
  CHECK_STATUSES,
  type CheckResult,
  type CheckStatus,
  type Evidence,
  type ResponseRecord,
  type ResponseStatus,
  type ResultFlag,
  type ResultVariant,
  type Variant,
} from "./types";

type Responses = { a: ResponseRecord; b: ResponseRecord };

const RESPONSE_LABEL: Record<ResponseStatus, string> = {
  ok: "OK",
  model_error: "Model error",
  timeout: "Timed out",
  credentials_unavailable: "Credentials unavailable",
  not_run: "Not run",
};

const KNOWN_FLAGS: readonly ResultFlag[] = ["unsupported_claim", "malformed", "vacuous"];
const PROVENANCES = ["user_provided", "user_provided_restricted", "system_introduced"] as const;

function fromOutcome(checkId: string, variant: ResultVariant, out: CheckOutcome): CheckResult {
  const r: CheckResult = {
    checkId,
    variant,
    status: out.status,
    evidence: out.evidence,
    rationale: out.rationale,
    flags: out.flags ? [...out.flags] : [],
  };
  if (out.omissionTerms) r.omissionTerms = out.omissionTerms;
  return r;
}

function errorResult(checkId: string, variant: ResultVariant, rationale: string): CheckResult {
  return { checkId, variant, status: "error", evidence: [], rationale, flags: ["malformed"] };
}

function notEvaluated(checkId: string, variant: ResultVariant, why: string): CheckResult {
  return { checkId, variant, status: "not_evaluated", evidence: [], rationale: why, flags: [] };
}

type ExpectedKey = { check: CheckDef; variant: ResultVariant };

function expectedKeys(s: Scenario): ExpectedKey[] {
  return s.checks.flatMap((check): ExpectedKey[] =>
    check.scope === "each"
      ? [
          { check, variant: "a" },
          { check, variant: "b" },
        ]
      : [{ check, variant: "pair" }],
  );
}

/** Evaluates every expected (check, variant) over the responses. */
export function evaluate(s: Scenario, responses: Responses): CheckResult[] {
  const inputs = renderInputs(s);
  const out: CheckResult[] = [];
  for (const { check, variant } of expectedKeys(s)) {
    if (variant === "pair") {
      const notOk = (["a", "b"] as const).filter((v) => responses[v].status !== "ok");
      if (notOk.length > 0) {
        out.push(
          notEvaluated(
            check.id,
            "pair",
            `Not evaluated: ${notOk.map((v) => `Version ${v.toUpperCase()} ${RESPONSE_LABEL[responses[v].status].toLowerCase()}`).join("; ")}.`,
          ),
        );
        continue;
      }
      if (!check.evaluatePair) {
        out.push(errorResult(check.id, "pair", "Evaluator error: pair check has no evaluator."));
        continue;
      }
      try {
        out.push(fromOutcome(check.id, "pair", check.evaluatePair(responses.a.text ?? "", responses.b.text ?? "", inputs.a, inputs.b)));
      } catch {
        out.push(errorResult(check.id, "pair", "Evaluator error: the check raised an error."));
      }
      continue;
    }
    const resp = responses[variant];
    if (resp.status !== "ok") {
      out.push(notEvaluated(check.id, variant, `Not evaluated: ${RESPONSE_LABEL[resp.status].toLowerCase()}.`));
      continue;
    }
    if (!check.evaluateEach) {
      out.push(errorResult(check.id, variant, "Evaluator error: check has no evaluator."));
      continue;
    }
    try {
      out.push(fromOutcome(check.id, variant, check.evaluateEach(resp.text ?? "", inputs[variant], variant)));
    } catch {
      out.push(errorResult(check.id, variant, "Evaluator error: the check raised an error."));
    }
  }
  return out;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isValidEvidence(e: unknown, resultVariant: ResultVariant, responses: Responses): e is Evidence {
  if (!isRecord(e)) return false;
  const { variant, start, end, excerpt } = e;
  if (variant !== "a" && variant !== "b") return false;
  if (resultVariant !== "pair" && variant !== resultVariant) return false;
  if (typeof start !== "number" || typeof end !== "number" || !Number.isInteger(start) || !Number.isInteger(end)) return false;
  const text = responses[variant as Variant].text ?? "";
  if (!(start >= 0 && start < end && end <= text.length)) return false;
  if (typeof excerpt !== "string" || excerpt !== text.slice(start, end)) return false;
  if (e.provenance !== undefined && !(PROVENANCES as readonly unknown[]).includes(e.provenance)) return false;
  return true;
}

function cleanEvidence(e: Evidence): Evidence {
  const out: Evidence = { variant: e.variant, start: e.start, end: e.end, excerpt: e.excerpt };
  if (e.provenance) out.provenance = e.provenance;
  return out;
}

function unsupported(base: CheckResult, why: string): CheckResult {
  return {
    ...base,
    status: "inconclusive",
    flags: Array.from(new Set<ResultFlag>([...base.flags, "unsupported_claim"])),
    rationale: `Unsupported claim: ${why} Original rationale: ${base.rationale}`,
  };
}

function validateOne(check: CheckDef, variant: ResultVariant, raw: Record<string, unknown>, responses: Responses): CheckResult {
  const { status, evidence, rationale } = raw;
  if (typeof status !== "string" || !(CHECK_STATUSES as readonly string[]).includes(status)) {
    return errorResult(check.id, variant, "Evaluator error (malformed): unknown status.");
  }
  if (!Array.isArray(evidence)) {
    return errorResult(check.id, variant, "Evaluator error (malformed): evidence is not a list.");
  }
  if (typeof rationale !== "string") {
    return errorResult(check.id, variant, "Evaluator error (malformed): rationale is not text.");
  }
  const st = status as CheckStatus;

  const sides: Variant[] = variant === "pair" ? ["a", "b"] : [variant];
  if (st !== "not_evaluated" && sides.some((v) => responses[v].status !== "ok")) {
    return errorResult(check.id, variant, "Evaluator error (malformed): a result was reported for a response that was not evaluated.");
  }

  const flags = Array.isArray(raw.flags)
    ? Array.from(new Set(raw.flags.filter((f): f is ResultFlag => (KNOWN_FLAGS as readonly unknown[]).includes(f))))
    : [];
  const valid = evidence.filter((e) => isValidEvidence(e, variant, responses)).map(cleanEvidence);
  const invalidCount = evidence.length - valid.length;

  const base: CheckResult = { checkId: check.id, variant, status: st, evidence: valid, rationale, flags };
  if (Array.isArray(raw.omissionTerms) && raw.omissionTerms.every((t) => typeof t === "string")) {
    base.omissionTerms = raw.omissionTerms as string[];
  }

  if (st === "pass" || st === "fail") {
    if (invalidCount > 0) {
      return unsupported(base, `${invalidCount} evidence item(s) failed the bounds-and-slice check.`);
    }
    if (st === "pass" && valid.length === 0) {
      return unsupported(base, "a pass must cite at least one excerpt.");
    }
    if (st === "fail" && valid.length === 0) {
      const terms = check.omissionTerms;
      if (!terms || terms.length === 0) {
        return unsupported(base, "a fail must cite at least one excerpt.");
      }
      const present = sides.some((v) => findTerms(responses[v].text ?? "", terms).length > 0);
      if (present) {
        return unsupported(base, "an omission fail was reported, but the omitted terms appear in the response.");
      }
    }
    return base;
  }

  if (invalidCount > 0) {
    base.rationale = `${rationale} (${invalidCount} invalid evidence item(s) removed.)`;
  }
  return base;
}

/**
 * Checks results against the expected set from the scenario definition.
 * Missing or duplicate results → error/malformed; bad evidence → inconclusive/unsupported_claim.
 */
export function validateResults(
  s: Scenario,
  responses: Responses,
  results: unknown[],
): { results: CheckResult[]; notes: string[] } {
  const notes: string[] = [];
  const keys = expectedKeys(s);
  const expected = new Set(keys.map((k) => `${k.check.id}/${k.variant}`));
  const grouped = new Map<string, Record<string, unknown>[]>();

  results.forEach((raw, i) => {
    if (!isRecord(raw)) {
      notes.push(`Dropped result #${i + 1}: not an object.`);
      return;
    }
    const k = `${String(raw.checkId)}/${String(raw.variant)}`;
    if (!expected.has(k)) {
      notes.push(`Dropped unknown result ${k}.`);
      return;
    }
    const list = grouped.get(k) ?? [];
    list.push(raw);
    grouped.set(k, list);
  });

  const out = keys.map(({ check, variant }) => {
    const list = grouped.get(`${check.id}/${variant}`) ?? [];
    if (list.length === 0) return errorResult(check.id, variant, "Evaluator error (malformed): Missing result.");
    if (list.length > 1) return errorResult(check.id, variant, `Evaluator error (malformed): Duplicate results (${list.length}).`);
    return validateOne(check, variant, list[0], responses);
  });
  return { results: out, notes };
}

export function emptyCounts(): Record<CheckStatus, number> {
  return { pass: 0, fail: 0, inconclusive: 0, not_evaluated: 0, error: 0 };
}

export function countStatuses(results: Array<{ status: CheckStatus }>): Record<CheckStatus, number> {
  const counts = emptyCounts();
  for (const r of results) counts[r.status] += 1;
  return counts;
}

export function scenarioVerdict(results: CheckResult[]): { headline: string; counts: Record<CheckStatus, number> } {
  const counts = countStatuses(results);
  const incomplete = counts.error > 0 || counts.not_evaluated > 0;
  let headline: string;
  if (counts.fail > 0) headline = incomplete ? "Checks failed (incomplete)" : "Checks failed";
  else if (incomplete || results.length === 0) headline = "Incomplete — not a pass";
  else if (counts.inconclusive > 0) headline = "Inconclusive";
  else headline = "All displayed checks passed";
  return { headline, counts };
}
