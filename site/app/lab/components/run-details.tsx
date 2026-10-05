import type { Scenario } from "../../../lib/lab/scenarios";
import type { Run, Variant } from "../../../lib/lab/types";
import { HighlightedText } from "../highlight";
import { ModeBadge, RESPONSE_STATUS_TEXT } from "./status";

function na(v: number | null): string {
  return v === null ? "n/a" : String(v);
}

function list(items: string[] | undefined): string {
  return items && items.length > 0 ? items.join(", ") : "none";
}

/** Compact run metadata: mode, provider/model, config, fingerprint, timestamp. */
export function RunMeta({ run, title }: { run: Run; title?: string }) {
  const rules = Array.from(new Set([...(run.responses.a.rulesMatched ?? []), ...(run.responses.b.rulesMatched ?? [])]));
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      {title && <p className="mb-2 text-sm font-semibold text-zinc-100">{title}</p>}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-zinc-400">Mode</dt>
        <dd>
          <ModeBadge mode={run.mode} />
        </dd>
        <dt className="text-zinc-400">Run ID</dt>
        <dd className="font-mono text-zinc-300">{run.id}</dd>
        <dt className="text-zinc-400">Provider</dt>
        <dd className="text-zinc-300">{run.config.provider}</dd>
        <dt className="text-zinc-400">Model</dt>
        <dd className="font-mono text-zinc-300">{run.config.model}</dd>
        <dt className="text-zinc-400">Temperature</dt>
        <dd className="text-zinc-300">{na(run.config.temperature)}</dd>
        <dt className="text-zinc-400">Max tokens</dt>
        <dd className="text-zinc-300">{na(run.config.maxTokens)}</dd>
        <dt className="text-zinc-400">Instruction fingerprint</dt>
        <dd className="font-mono text-zinc-300">{run.instructionFingerprint}</dd>
        <dt className="text-zinc-400">Created at</dt>
        <dd className="font-mono text-zinc-300">{run.createdAt}</dd>
        {run.mode === "simulated" && (
          <>
            <dt className="text-zinc-400">Simulator rules matched</dt>
            <dd className="text-zinc-300">{list(rules)}</dd>
            <dt className="text-zinc-400">Failure modes applied</dt>
            <dd className="text-zinc-300">
              A: {list(run.responses.a.failureModesApplied)}; B: {list(run.responses.b.failureModesApplied)}
            </dd>
            <dt className="text-zinc-400">Fault injected</dt>
            <dd className="text-zinc-300">{run.faultInjected ?? "none"}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function VariantCard({ scenario, run, v }: { scenario: Scenario; run: Run; v: Variant }) {
  const input = run.inputsSent[v];
  const value = scenario.variable[v].value;
  const prefixLen = input.indexOf(value);
  const response = run.responses[v];
  const spans = run.results.flatMap((r) => r.evidence.filter((e) => e.variant === v));
  const okText = run.mode === "simulated" ? "Simulated response" : "Response";
  return (
    <div className="rounded-lg border border-zinc-800 p-4">
      <h3 className="scroll-mt-24 text-base font-semibold text-zinc-100">{scenario.variable[v].label}</h3>
      <p className="mt-3 text-xs font-mono uppercase tracking-wider text-zinc-400">User input</p>
      <p className="mt-1 whitespace-pre-wrap rounded-md bg-zinc-900 p-3 text-sm text-zinc-300">
        <HighlightedText
          text={input}
          spans={prefixLen >= 0 ? [{ start: prefixLen, end: prefixLen + value.length }] : []}
          markClassName="rounded-sm bg-sky-400/20 px-0.5 text-sky-200 underline decoration-sky-300 decoration-2 underline-offset-2"
        />
      </p>
      <p className="mt-3 text-xs font-mono uppercase tracking-wider text-zinc-400">{okText}</p>
      {response.status === "ok" ? (
        <p className="mt-1 whitespace-pre-wrap rounded-md bg-zinc-900 p-3 text-sm text-zinc-300">
          <HighlightedText text={response.text ?? ""} spans={spans} />
        </p>
      ) : (
        <p className="mt-1 rounded-md border border-zinc-700 p-3 text-sm text-zinc-300">
          <span aria-hidden="true">— </span>
          {RESPONSE_STATUS_TEXT[response.status]}
          {response.error ? <span className="block text-zinc-400">{response.error}</span> : null}
        </p>
      )}
      <p className="mt-2 text-sm text-zinc-400">
        Response status: {response.status === "ok" ? "OK" : RESPONSE_STATUS_TEXT[response.status]}
      </p>
    </div>
  );
}

export function RunDetails({ scenario, run }: { scenario: Scenario; run: Run }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 p-4">
        <p className="text-xs font-mono uppercase tracking-wider text-zinc-400">Instruction used</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{run.instruction.length > 0 ? run.instruction : "(empty instruction)"}</p>
        <p className="mt-2 text-sm text-zinc-400">
          Fingerprint: <span className="font-mono text-zinc-300">{run.instructionFingerprint}</span>
        </p>
      </div>
      <p className="text-sm text-zinc-400">
        The two inputs are identical except for the highlighted {scenario.variable.name}. Both versions get the same instruction and
        config in independent calls.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <VariantCard scenario={scenario} run={run} v="a" />
        <VariantCard scenario={scenario} run={run} v="b" />
      </div>
      {scenario.notes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-400">
          {scenario.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <RunMeta run={run} title="Run metadata" />
    </div>
  );
}
