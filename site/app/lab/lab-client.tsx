"use client";

import { useRef, useState } from "react";
import { scenarioVerdict } from "../../lib/lab/evaluate";
import { createOverride, reviewLogJson } from "../../lib/lab/overrides";
import { LIVE_CONFIG, LIVE_RESPONDER_VERSION, makeLiveResponder, runScenario } from "../../lib/lab/run";
import { scenarios } from "../../lib/lab/scenarios";
import { matchSnippets, SIMULATED_CONFIG, SIMULATOR_VERSION, simulatedResponder, SNIPPET_RULES } from "../../lib/lab/simulator";
import type { CheckResult, FaultKind, Override, Run } from "../../lib/lab/types";
import { CompareView } from "./components/compare-view";
import { Findings } from "./components/findings";
import { Limitations, SimulatorRules } from "./components/reference";
import { RunDetails } from "./components/run-details";
import { BUTTON, FOCUS, statusLabel } from "./components/status";

const MAX_INSTRUCTION = 4000;
const NO_MATCH =
  "No simulator rule matched your edit; simulated output is unchanged. A real model would respond to arbitrary wording.";
const LIVE_UNAVAILABLE = "Live mode unavailable on this deployment — this is not an evaluation result.";

const FAULTS: Array<[FaultKind, string]> = [
  ["none", "None"],
  ["model_error", "Model error (Version B)"],
  ["timeout", "Timeout (Version B)"],
  ["credentials_unavailable", "Credentials unavailable (both versions)"],
  ["malformed_result", "Malformed result (evaluator output)"],
];

const SECTIONS: Array<[string, string]> = [
  ["choose", "1. Choose a scenario"],
  ["inspect", "2. Inspect paired inputs and responses"],
  ["findings", "3. Review findings"],
  ["edit", "4. Edit the instruction and rerun"],
  ["compare", "5. Compare runs"],
  ["review-log", "6. Human review log"],
];

const H2 = "scroll-mt-24 text-2xl font-bold tracking-tight text-zinc-100";

export function LabClient({ baselineRuns }: { baselineRuns: Run[] }) {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [instructions, setInstructions] = useState<Record<string, string>>(() =>
    Object.fromEntries(scenarios.map((s) => [s.id, s.baselineInstruction])),
  );
  const [latest, setLatest] = useState<Record<string, Run | undefined>>({});
  const [runCount, setRunCount] = useState<Record<string, number>>({});
  const [view, setView] = useState<"baseline" | "latest">("latest");
  const [source, setSource] = useState<"simulated" | "live">("simulated");
  const [fault, setFault] = useState<FaultKind>("none");
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [noMatch, setNoMatch] = useState(false);
  const running = useRef(false);

  const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0];
  const baseline = baselineRuns.find((r) => r.scenarioId === scenario.id);
  const latestRun = latest[scenario.id];
  const shown = view === "latest" && latestRun ? latestRun : baseline;
  const instruction = instructions[scenario.id] ?? "";

  function chooseScenario(id: string) {
    setScenarioId(id);
    setNoMatch(false);
    setError(null);
  }

  function setInstruction(text: string) {
    setInstructions((prev) => ({ ...prev, [scenario.id]: text.slice(0, MAX_INSTRUCTION) }));
  }

  function addPreset(snippet: string) {
    setInstruction(instruction + "\n" + snippet);
  }

  async function rerun() {
    if (running.current) return;
    running.current = true;
    const s = scenario;
    const n = (runCount[s.id] ?? 0) + 1;
    const live = source === "live";
    try {
      const run = await runScenario(
        s,
        instruction,
        live ? makeLiveResponder(s.id) : simulatedResponder,
        live ? LIVE_CONFIG : SIMULATED_CONFIG,
        {
          id: `${s.id}-run-${n}`,
          createdAt: new Date().toISOString(),
          mode: live ? "live" : "simulated",
          responderVersion: live ? LIVE_RESPONDER_VERSION : SIMULATOR_VERSION,
          fault: live ? "none" : fault,
        },
      );
      setLatest((prev) => ({ ...prev, [s.id]: run }));
      setRunCount((prev) => ({ ...prev, [s.id]: n }));
      setView("latest");
      setAnnouncement(`Run ${n} complete: ${scenarioVerdict(run.results).headline}`);
      setNoMatch(!live && instruction !== s.baselineInstruction && matchSnippets(instruction).length === 0);
      setError(live ? LIVE_UNAVAILABLE : null);
    } catch {
      setError("The run could not be completed. This is not an evaluation result.");
    } finally {
      running.current = false;
    }
  }

  function saveOverride(run: Run, result: CheckResult, humanStatus: string, reason: string): string | null {
    const out = createOverride(run, result, humanStatus, reason, new Date().toISOString());
    if (!out.ok) return out.error;
    setOverrides((prev) => [...prev, out.override]);
    return null;
  }

  function downloadLog() {
    const blob = new Blob([reviewLogJson(overrides)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inclusive-lab-review-log.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-16 text-zinc-300">
      <header className="mb-8">
        <h1 className="scroll-mt-24 text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl">Evaluation Lab</h1>
        <p className="mt-4 max-w-3xl text-lg text-zinc-300">
          Inspect how an assistant handles LGBTQIA+-specific situations, change its system instruction, rerun, and compare. Each scenario
          sends two inputs that differ in exactly one detail. Checks are deterministic word-matching rules; every failure points to the
          exact words that triggered it.
        </p>
      </header>

      <div role="note" className="mb-8 rounded-xl border-2 border-amber-300/70 bg-amber-950/40 p-4 text-amber-100">
        <p>
          <strong>Simulated demo — no AI model is called.</strong> Responses come from a scripted simulator (lab-simulator-rules-v1) built
          to show known failure modes. An improvement here demonstrates the workflow, not real model behavior. All people, organizations,
          and data are fictional.
        </p>
      </div>

      <nav aria-label="Lab steps" className="mb-12">
        <ol className="flex flex-wrap gap-2 text-sm">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className={`inline-block rounded-lg border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:border-zinc-500 ${FOCUS}`}>
                {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-16">
        <section aria-labelledby="choose">
          <h2 id="choose" className={H2}>
            1. Choose a scenario
          </h2>
          <fieldset className="mt-4">
            <legend className="text-sm text-zinc-400">
              Scenario <span className="ml-2 rounded-full border border-zinc-600 px-2 py-0.5 text-xs text-zinc-300">Fictional data</span>
            </legend>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {scenarios.map((s) => (
                <label
                  key={s.id}
                  className={`block cursor-pointer rounded-lg border p-4 ${s.id === scenario.id ? "border-sky-400 bg-sky-950/30" : "border-zinc-800"}`}
                >
                  <span className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="scenario"
                      value={s.id}
                      checked={s.id === scenario.id}
                      onChange={() => chooseScenario(s.id)}
                      className={`mt-1 ${FOCUS}`}
                    />
                    <span>
                      <span className="block font-semibold text-zinc-100">{s.title}</span>
                      <span className="block text-sm text-zinc-400">{s.context}</span>
                      <span className="mt-2 block text-sm text-zinc-300">{s.harm}</span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section aria-labelledby="inspect">
          <h2 id="inspect" className={H2}>
            2. Inspect paired inputs and responses
          </h2>
          {latestRun && (
            <fieldset className="mt-4">
              <legend className="text-sm text-zinc-400">Show run</legend>
              <div className="mt-1 flex gap-4 text-sm">
                {(["baseline", "latest"] as const).map((v) => (
                  <label key={v} className="inline-flex items-center gap-2">
                    <input type="radio" name="view-run" value={v} checked={view === v} onChange={() => setView(v)} className={FOCUS} />
                    {v === "baseline" ? "Baseline run" : `Latest run (${latestRun.id})`}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="mt-4">{shown ? <RunDetails scenario={scenario} run={shown} /> : <p>Not run</p>}</div>
        </section>

        <section aria-labelledby="findings">
          <h2 id="findings" className={H2}>
            3. Review findings
          </h2>
          <div className="mt-4">
            {shown ? <Findings scenario={scenario} run={shown} overrides={overrides} onSave={saveOverride} /> : <p>Not run</p>}
          </div>
        </section>

        <section aria-labelledby="edit">
          <h2 id="edit" className={H2}>
            4. Edit the instruction and rerun
          </h2>
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="lab-instruction" className="block font-medium text-zinc-100">
                System instruction for “{scenario.title}”
              </label>
              <textarea
                id="lab-instruction"
                rows={7}
                maxLength={MAX_INSTRUCTION}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                aria-describedby="lab-instruction-count"
                className={`mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 p-3 font-mono text-sm text-zinc-100 ${FOCUS}`}
              />
              <p id="lab-instruction-count" className="text-sm text-zinc-400">
                {instruction.length} / {MAX_INSTRUCTION} characters
              </p>
            </div>
            <div role="group" aria-labelledby="lab-presets" className="space-y-2">
              <p id="lab-presets" className="text-sm text-zinc-400">
                Presets append a documented simulator snippet to the instruction:
              </p>
              <div className="flex flex-col gap-2">
                {scenario.presets.map((id) => {
                  const rule = SNIPPET_RULES.find((r) => r.id === id);
                  if (!rule) return null;
                  return (
                    <button key={id} type="button" className={`${BUTTON} text-left`} onClick={() => addPreset(rule.snippet)}>
                      <span className="mr-2 font-mono text-xs text-zinc-400">
                        {rule.id} ({rule.kind})
                      </span>
                      {rule.snippet}
                    </button>
                  );
                })}
                <button type="button" className={`${BUTTON} self-start`} onClick={() => setInstruction(scenario.baselineInstruction)}>
                  Reset to the baseline instruction
                </button>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <fieldset>
                <legend className="font-medium text-zinc-100">Response source</legend>
                <div className="mt-2 space-y-1 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="response-source"
                      value="simulated"
                      checked={source === "simulated"}
                      onChange={() => setSource("simulated")}
                      className={FOCUS}
                    />
                    Simulated
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="response-source"
                      value="live"
                      checked={source === "live"}
                      onChange={() => setSource("live")}
                      className={FOCUS}
                    />
                    Live model (not configured on this deployment)
                  </label>
                </div>
              </fieldset>
              <div>
                <label htmlFor="lab-fault" className="block font-medium text-zinc-100">
                  Fault injection (simulated only)
                </label>
                <select
                  id="lab-fault"
                  value={fault}
                  disabled={source === "live"}
                  onChange={(e) => setFault(e.target.value as FaultKind)}
                  className={`mt-2 rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100 disabled:opacity-60 ${FOCUS}`}
                >
                  {FAULTS.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <button type="button" onClick={rerun} className={`${BUTTON} px-5 py-2 font-semibold`}>
                Rerun
              </button>
              <p role="status" aria-live="polite" className="text-sm text-zinc-300">
                {announcement}
              </p>
            </div>
            {error && (
              <p role="alert" className="rounded-md border border-rose-400/60 p-3 text-sm text-rose-200">
                {error}
              </p>
            )}
            {noMatch && <p className="rounded-md border border-zinc-600 p-3 text-sm text-zinc-300">{NO_MATCH}</p>}
          </div>
        </section>

        <section aria-labelledby="compare">
          <h2 id="compare" className={H2}>
            5. Compare runs
          </h2>
          <p className="mt-2 text-sm text-zinc-400">Baseline vs latest run for the selected scenario.</p>
          <div className="mt-4">
            {baseline ? <CompareView scenario={scenario} baseline={baseline} latest={latestRun} overrides={overrides} /> : <p>Not run</p>}
          </div>
        </section>

        <section aria-labelledby="review-log">
          <h2 id="review-log" className={H2}>
            6. Human review log
          </h2>
          <p className="mt-2 text-sm text-zinc-400">Stored only in this browser tab; do not enter real personal data.</p>
          {overrides.length === 0 ? (
            <p className="mt-4 text-zinc-300">No human reviews yet. Use “Disagree with this result” on a finding.</p>
          ) : (
            <ol className="mt-4 list-decimal space-y-2 pl-6 text-sm text-zinc-300">
              {overrides.map((o, i) => (
                <li key={i}>
                  <span className="font-mono text-zinc-400">{o.runId}</span> · {o.checkId} · {o.variant}: human {statusLabel(o.humanStatus)},
                  automated {statusLabel(o.automatedStatus)}. Reason: {o.reason}
                </li>
              ))}
            </ol>
          )}
          <button type="button" className={`${BUTTON} mt-4`} onClick={downloadLog}>
            Download review log (JSON)
          </button>
        </section>

        <section aria-labelledby="simulator-rules">
          <h2 id="simulator-rules" className={H2}>
            Simulator rules
          </h2>
          <div className="mt-4">
            <SimulatorRules />
          </div>
        </section>

        <section aria-labelledby="limitations">
          <h2 id="limitations" className={H2}>
            Limitations
          </h2>
          <div className="mt-4">
            <Limitations />
          </div>
        </section>
      </div>
    </div>
  );
}
