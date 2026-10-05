import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { scenarioVerdict } from "../../../lib/lab/evaluate";
import { canOverride, countsAfterReview, latestOverrides } from "../../../lib/lab/overrides";
import type { CheckDef, Scenario } from "../../../lib/lab/scenarios";
import type { CheckResult, CheckStatus, Override, Run } from "../../../lib/lab/types";
import { BUTTON, FLAG_LABEL, FOCUS, PROVENANCE_LABEL, StatusBadge, statusLabel, variantLabel } from "./status";

export type SaveOverride = (run: Run, result: CheckResult, humanStatus: string, reason: string) => string | null;

const COUNT_ORDER: Array<[CheckStatus, string]> = [
  ["pass", "Pass"],
  ["fail", "Fail"],
  ["inconclusive", "Inconclusive"],
  ["not_evaluated", "Not evaluated"],
  ["error", "Error"],
];

function Counts({ label, counts }: { label: string; counts: Record<CheckStatus, number> }) {
  return (
    <div className="rounded-lg border border-zinc-800 p-3">
      <h3 className="text-sm font-semibold text-zinc-100">{label}</h3>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-300">
        {COUNT_ORDER.map(([k, name]) => (
          <li key={k}>
            {name}: <span className="font-mono">{counts[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Rubric({ check }: { check: CheckDef }) {
  const rows: Array<[string, string]> = [
    ["Criterion", check.criterion],
    ["Why it matters", check.whyItMatters],
    ["Method", check.method],
    ["Pass means", check.passMeans],
    ["Fail means", check.failMeans],
    ["Inconclusive means", check.inconclusiveMeans],
    ["Limitations", check.limitations],
  ];
  return (
    <details className="mt-3 rounded-md border border-zinc-800 p-3">
      <summary className={`cursor-pointer text-sm font-medium text-zinc-200 ${FOCUS}`}>Rubric</summary>
      <dl className="mt-2 space-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-zinc-400">{k}</dt>
            <dd className="text-zinc-300">{v}</dd>
          </div>
        ))}
        <div>
          <dt className="text-zinc-400">Lexicon</dt>
          <dd>
            <ul className="space-y-1 text-zinc-300">
              {Object.entries(check.lexicon).map(([k, terms]) => (
                <li key={k}>
                  <span className="text-zinc-400">{k}:</span> {terms.map((t) => `“${t}”`).join(", ")}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </details>
  );
}

function OverrideControl({
  run,
  result,
  existing,
  onSave,
}: {
  run: Run;
  result: CheckResult;
  existing?: Override;
  onSave: SaveOverride;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [human, setHuman] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstRadioRef = useRef<HTMLInputElement>(null);
  const allowed = canOverride(result);

  useEffect(() => {
    if (open) firstRadioRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setError(null);
    buttonRef.current?.focus();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const err = onSave(run, result, human, reason);
    if (err) {
      setError(err);
      return;
    }
    setHuman("");
    setReason("");
    close();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  return (
    <div className="mt-3">
      {existing && (
        <p className="mb-2 border-l-4 border-sky-400 bg-sky-950/40 py-1 pl-3 text-sm text-sky-100">
          Human review: {statusLabel(existing.humanStatus)} — automated result: {statusLabel(existing.automatedStatus)}. Reason:{" "}
          {existing.reason}
        </p>
      )}
      <button
        ref={buttonRef}
        type="button"
        className={BUTTON}
        disabled={!allowed}
        aria-expanded={allowed ? open : undefined}
        aria-controls={allowed && open ? `${id}-form` : undefined}
        aria-describedby={allowed ? undefined : `${id}-why`}
        onClick={() => setOpen((o) => !o)}
      >
        Disagree with this result
      </button>
      {!allowed && (
        <p id={`${id}-why`} className="mt-1 text-sm text-zinc-400">
          Human review is unavailable because this check was not evaluated or had an evaluator error.
        </p>
      )}
      {allowed && open && (
        <form id={`${id}-form`} noValidate onSubmit={submit} onKeyDown={onKeyDown} className="mt-3 space-y-3 rounded-md border border-zinc-700 p-3">
          <fieldset>
            <legend className="text-sm font-medium text-zinc-200">Your verdict (required)</legend>
            <div className="mt-1 flex flex-wrap gap-4 text-sm text-zinc-300">
              {(["pass", "fail", "inconclusive"] as const).map((v, i) => (
                <label key={v} className="inline-flex items-center gap-2">
                  <input
                    ref={i === 0 ? firstRadioRef : undefined}
                    type="radio"
                    name={`${id}-human`}
                    value={v}
                    checked={human === v}
                    onChange={() => setHuman(v)}
                    className={FOCUS}
                  />
                  {statusLabel(v)}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={`${id}-reason`} className="block text-sm font-medium text-zinc-200">
              Reason (required)
            </label>
            <textarea
              id={`${id}-reason`}
              required
              rows={3}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={`mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100 ${FOCUS}`}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" className={BUTTON}>
              Save
            </button>
            <button type="button" className={BUTTON} onClick={close}>
              Cancel
            </button>
          </div>
          <p className="text-xs text-zinc-400">Press Escape to cancel. The automated result stays visible and unchanged.</p>
        </form>
      )}
    </div>
  );
}

function FindingRow({
  scenario,
  run,
  result,
  existing,
  onSave,
}: {
  scenario: Scenario;
  run: Run;
  result: CheckResult;
  existing?: Override;
  onSave: SaveOverride;
}) {
  const check = scenario.checks.find((c) => c.id === result.checkId);
  return (
    <li className="rounded-lg border border-zinc-800 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="scroll-mt-24 text-base font-semibold text-zinc-100">
          {check?.title ?? result.checkId} <span className="font-normal text-zinc-400">· {variantLabel(scenario, result.variant)}</span>
        </h3>
        <StatusBadge status={result.status} flags={result.flags} />
      </div>
      {check && (
        <p className="mt-2 text-sm text-zinc-300">
          <span className="text-zinc-400">Criterion:</span> {check.criterion}
        </p>
      )}
      {check && (
        <p className="mt-1 text-sm text-zinc-400">
          <span>Method:</span> {check.method}
        </p>
      )}
      <p className="mt-2 text-sm text-zinc-300">
        <span className="text-zinc-400">Rationale:</span> {result.rationale}
      </p>
      {result.flags.length > 0 && (
        <p className="mt-1 text-sm text-zinc-300">
          <span className="text-zinc-400">Flags:</span> {result.flags.map((f) => FLAG_LABEL[f]).join(", ")}
        </p>
      )}
      {result.evidence.length > 0 && (
        <div className="mt-2">
          <p className="text-sm text-zinc-400">Evidence (highlighted in the response):</p>
          <ol className="mt-1 list-decimal space-y-1 pl-6 text-sm text-zinc-300">
            {result.evidence.map((e, i) => (
              <li key={i}>
                <mark className="rounded-sm bg-amber-300/20 text-zinc-100 underline decoration-amber-300 decoration-2 underline-offset-2">
                  {e.excerpt}
                </mark>{" "}
                — Version {e.variant.toUpperCase()}, characters {e.start}–{e.end}
                {e.provenance ? `; provenance: ${PROVENANCE_LABEL[e.provenance]}` : ""}
              </li>
            ))}
          </ol>
        </div>
      )}
      {result.omissionTerms && result.omissionTerms.length > 0 && result.evidence.length === 0 && (
        <p className="mt-1 text-sm text-zinc-300">
          <span className="text-zinc-400">Not found in the response:</span> {result.omissionTerms.map((t) => `“${t}”`).join(", ")}
        </p>
      )}
      {check && <Rubric check={check} />}
      <OverrideControl run={run} result={result} existing={existing} onSave={onSave} />
    </li>
  );
}

export function Findings({
  scenario,
  run,
  overrides,
  onSave,
}: {
  scenario: Scenario;
  run: Run;
  overrides: Override[];
  onSave: SaveOverride;
}) {
  const verdict = scenarioVerdict(run.results);
  const latest = latestOverrides(overrides, run.id);
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-4">
        <p className="text-xl font-semibold text-zinc-100">{verdict.headline}</p>
        <p className="mt-1 text-sm text-zinc-400">A pass means only that the displayed checks passed.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Counts label="Automated" counts={verdict.counts} />
        <Counts label="After human review" counts={countsAfterReview(run.results, overrides, run.id)} />
      </div>
      <p className="text-sm text-zinc-400">
        Provenance labels come from word matching against the user&apos;s input; they do not identify who a word refers to.
      </p>
      {run.validationNotes.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-zinc-400">
          {run.validationNotes.map((n, i) => (
            <li key={i}>Validation note: {n}</li>
          ))}
        </ul>
      )}
      <ol className="space-y-3">
        {run.results.map((r) => (
          <FindingRow
            key={`${r.checkId}/${r.variant}`}
            scenario={scenario}
            run={run}
            result={r}
            existing={latest.get(`${r.checkId}/${r.variant}`)}
            onSave={onSave}
          />
        ))}
      </ol>
    </div>
  );
}
