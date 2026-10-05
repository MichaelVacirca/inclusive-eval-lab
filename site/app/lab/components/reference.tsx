import { FAILURE_MODES, SIMULATOR_VERSION, SNIPPET_RULES } from "../../../lib/lab/simulator";

export function SimulatorRules() {
  return (
    <div className="space-y-6">
      <p className="text-zinc-300">
        The simulator ({SIMULATOR_VERSION}) is a fixed set of rules. It reads only the instruction and the rendered input, never the
        version labels. A snippet matches only as a whole sentence (case and spacing ignored), so a negated or reworded sentence does not
        match.
      </p>
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-left text-sm">
          <caption className="px-4 py-2 text-left text-sm text-zinc-400">Snippet rules (preset buttons insert these exact sentences)</caption>
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400">
              <th scope="col" className="px-4 py-2 font-medium">ID</th>
              <th scope="col" className="px-4 py-2 font-medium">Kind</th>
              <th scope="col" className="px-4 py-2 font-medium">Snippet</th>
              <th scope="col" className="px-4 py-2 font-medium">Effect</th>
            </tr>
          </thead>
          <tbody>
            {SNIPPET_RULES.map((r) => (
              <tr key={r.id} className="border-b border-zinc-800/60 last:border-0 align-top">
                <th scope="row" className="px-4 py-2 font-mono text-zinc-200">{r.id}</th>
                <td className="px-4 py-2 text-zinc-300">{r.kind}</td>
                <td className="px-4 py-2 text-zinc-300">{r.snippet}</td>
                <td className="px-4 py-2 text-zinc-300">{r.effect}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-left text-sm">
          <caption className="px-4 py-2 text-left text-sm text-zinc-400">Scripted failure modes (triggered by input content only)</caption>
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400">
              <th scope="col" className="px-4 py-2 font-medium">ID</th>
              <th scope="col" className="px-4 py-2 font-medium">Scenario</th>
              <th scope="col" className="px-4 py-2 font-medium">Trigger</th>
              <th scope="col" className="px-4 py-2 font-medium">Effect</th>
              <th scope="col" className="px-4 py-2 font-medium">Turned off by</th>
            </tr>
          </thead>
          <tbody>
            {FAILURE_MODES.map((f) => (
              <tr key={f.id} className="border-b border-zinc-800/60 last:border-0 align-top">
                <th scope="row" className="px-4 py-2 font-mono text-zinc-200">{f.id}</th>
                <td className="px-4 py-2 text-zinc-300">{f.scenarioHint}</td>
                <td className="px-4 py-2 text-zinc-300">{f.trigger}</td>
                <td className="px-4 py-2 text-zinc-300">{f.effect}</td>
                <td className="px-4 py-2 text-zinc-300">{f.disabledBy.join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Limitations() {
  const items = [
    "Each run is a single sample; one pair of responses cannot establish a rate or a trend.",
    "Checks are word matching. They do not resolve who a word refers to, and wording outside the listed lexicons is missed.",
    "Simulated responses are scripted to demonstrate known failure modes; an improvement here demonstrates the workflow, not real assistant behavior.",
    "Lab results are independent of the inclusive-eval command-line tool, which uses a different runner and rubric; results are not expected to match.",
    "Live mode is not configured on this deployment; the live route always reports that credentials are unavailable.",
    "Human review overrides are kept in memory only and are lost when the tab closes; download the review log to keep them.",
  ];
  return (
    <ul className="list-disc space-y-1 pl-5 text-zinc-300">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}
