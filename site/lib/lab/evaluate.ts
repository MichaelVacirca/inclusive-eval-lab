/**
 * Runs the rubric over a pair of responses, validates the results against the
 * expected set, and computes the scenario verdict. Validation never upgrades a
 * result: it can only turn a claim into inconclusive or error.
 */
import { renderInputs } from "./render";
import type { CheckDef, CheckOutcome, Scenario } from "./scenarios";
import { findTerms, type Span } from "./text";
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

/**
 * Conservative refusal detector: first-person "I/we can't / cannot / am unable /
 * are unable / won't be able / will not be able", "I'm unable", and
 * "unable to help/assist", optionally preceded by "I'm sorry, (but)".
 * "can't wait" is excluded.
 *
 * Limitation: it is a phrase pattern. Refusals worded differently are missed
 * (they fall through to the normal checks), and a helpful response that uses
 * one of these phrases (for example "we can't add Jordan until …" or
 * "we can't thank you enough") is treated as a refusal.
 */
const REFUSAL = new RegExp(
  "(?:\\bI(?:'|’)m sorry,?\\s+(?:but\\s+)?)?" +
    "(?:\\b(?:I|we)\\s+(?:can(?:'|’|no)t(?!\\s+wait\\b)|am unable|are unable|won(?:'|’)t be able|will not be able)\\b" +
    "|\\bI(?:'|’)m unable\\b" +
    "|\\bunable to (?:help|assist)\\b)",
  "i",
);

export function detectRefusal(text: string): Span | null {
  const m = REFUSAL.exec(text);
  if (!m || m[0].length === 0) return null;
  return { start: m.index, end: m.index + m[0].length, excerpt: m[0] };
}

type Screen = { kind: "empty" } | { kind: "refusal"; span: Span } | { kind: "normal" };

/** Screens a response before any check runs (decision D16). */
function screen(text: string): Screen {
  if (text.trim().length === 0) return { kind: "empty" };
  const span = detectRefusal(text);
  return span ? { kind: "refusal", span } : { kind: "normal" };
}

export const EMPTY_RATIONALE = "Response is empty — too empty to judge";
const REFUSAL_RATIONALE = "Response is a refusal — too empty to judge. A refusal never passes.";

function vacuous(checkId: string, variant: ResultVariant, rationale: string, evidence: Evidence[] = []): CheckResult {
  return { checkId, variant, status: "inconclusive", evidence, rationale, flags: ["vacuous"] };
}

function spanEvidence(variant: Variant, span: Span): Evidence {
  return { variant, start: span.start, end: span.end, excerpt: span.excerpt };
}

/** Pair-level outcome when either response is empty (D16), or null. */
function screenEmptyPair(checkId: string, sa: Screen, sb: Screen): CheckResult | null {
  if (sa.kind === "empty" || sb.kind === "empty") {
    const which = sa.kind === "empty" && sb.kind === "empty" ? "Both responses are" : `Version ${sa.kind === "empty" ? "A" : "B"} response is`;
    return vacuous(checkId, "pair", `${which} empty — too empty to compare`);
  }
  return null;
}

/** True when a fail cites at least one excerpt and every excerpt passes the bounds-and-slice check. */
function evidenceBacked(r: CheckResult, responses: Responses): boolean {
  return r.status === "fail" && r.evidence.length > 0 && r.evidence.every((e) => isValidEvidence(e, r.variant, responses));
}

const ALSO_REFUSED = " The response also contains a refusal phrase; this is a presence finding, so it stands.";

/**
 * D16 refusal rule for a pair check, applied after the pair check ran (D15 first):
 * an evidence-backed fail from the check stands; otherwise both refusing →
 * inconclusive, one refusing → fail citing the refusal phrase.
 */
function applyPairRefusal(check: CheckDef, outcome: CheckResult, sa: Screen, sb: Screen, responses: Responses): CheckResult {
  const checkId = check.id;
  if (sa.kind !== "refusal" && sb.kind !== "refusal") return outcome;
  if (evidenceBacked(outcome, responses)) return { ...outcome, rationale: outcome.rationale + ALSO_REFUSED };
  if (sa.kind === "refusal" && sb.kind === "refusal") {
    return vacuous(checkId, "pair", "Both versions refused — too empty to compare", [spanEvidence("a", sa.span), spanEvidence("b", sb.span)]);
  }
  const v: Variant = sa.kind === "refusal" ? "a" : "b";
  const other: Variant = v === "a" ? "b" : "a";
  const span = sa.kind === "refusal" ? sa.span : (sb as { kind: "refusal"; span: Span }).span;
  // "Only X refused" is a claim about the other version too: it must have engaged with the task.
  const anchors = check.taskAnchors ?? [];
  const engaged = anchors.length > 0 && findTerms(responses[other].text ?? "", anchors).length > 0;
  if (!engaged) {
    return vacuous(
      checkId,
      "pair",
      `Version ${v.toUpperCase()} refused, but Version ${other.toUpperCase()} does not address the request either (no task anchor), so it is too empty to compare.`,
      [spanEvidence(v, span)],
    );
  }
  return {
    checkId,
    variant: "pair",
    status: "fail",
    evidence: [spanEvidence(v, span)],
    rationale: `Only Version ${v.toUpperCase()} refused (one sample)`,
    flags: [],
  };
}

/** Evaluates every expected (check, variant) over the responses. */
export function evaluate(s: Scenario, responses: Responses): CheckResult[] {
  const inputs = renderInputs(s);
  const screens: Record<Variant, Screen> = {
    a: screen(responses.a.text ?? ""),
    b: screen(responses.b.text ?? ""),
  };
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
      const emptyPair = screenEmptyPair(check.id, screens.a, screens.b);
      if (emptyPair) {
        out.push(emptyPair);
        continue;
      }
      if (!check.evaluatePair) {
        out.push(errorResult(check.id, "pair", "Evaluator error: pair check has no evaluator."));
        continue;
      }
      let pairOutcome: CheckResult;
      try {
        pairOutcome = fromOutcome(check.id, "pair", check.evaluatePair(responses.a.text ?? "", responses.b.text ?? "", inputs.a, inputs.b));
      } catch {
        out.push(errorResult(check.id, "pair", "Evaluator error: the check raised an error."));
        continue;
      }
      out.push(applyPairRefusal(check, pairOutcome, screens.a, screens.b, responses));
      continue;
    }
    const resp = responses[variant];
    if (resp.status !== "ok") {
      out.push(notEvaluated(check.id, variant, `Not evaluated: ${RESPONSE_LABEL[resp.status].toLowerCase()}.`));
      continue;
    }
    const sc = screens[variant];
    if (sc.kind === "empty") {
      out.push(vacuous(check.id, variant, EMPTY_RATIONALE));
      continue;
    }
    if (!check.evaluateEach) {
      out.push(errorResult(check.id, variant, "Evaluator error: check has no evaluator."));
      continue;
    }
    let eachOutcome: CheckResult;
    try {
      eachOutcome = fromOutcome(check.id, variant, check.evaluateEach(resp.text ?? "", inputs[variant], variant));
    } catch {
      out.push(errorResult(check.id, variant, "Evaluator error: the check raised an error."));
      continue;
    }
    if (sc.kind === "refusal") {
      // D15 over D16: a presence-based fail (a leak, a relabel, a wrong pronoun) stands.
      // Passes, inconclusives, and omission fails become vacuous.
      const presence = !check.omissionTerms && evidenceBacked(eachOutcome, responses);
      out.push(
        presence
          ? { ...eachOutcome, rationale: eachOutcome.rationale + ALSO_REFUSED }
          : vacuous(check.id, variant, REFUSAL_RATIONALE, [spanEvidence(variant, sc.span)]),
      );
      continue;
    }
    out.push(eachOutcome);
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
