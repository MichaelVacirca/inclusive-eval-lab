import { compareRuns, type RowClass } from "../../../lib/lab/compare";
import { latestOverrides } from "../../../lib/lab/overrides";
import type { Scenario } from "../../../lib/lab/scenarios";
import type { Override, Run } from "../../../lib/lab/types";
import { RunMeta } from "./run-details";
import { StatusBadge, statusLabel, variantLabel } from "./status";

const CLASS_TEXT: Record<RowClass, { icon: string; label: string; color: string }> = {
  improved: { icon: "↑", label: "Improved", color: "text-emerald-300" },
  regressed: { icon: "↓", label: "Regressed", color: "text-rose-300" },
  unchanged: { icon: "=", label: "Unchanged", color: "text-zinc-300" },
  inconclusive: { icon: "?", label: "Inconclusive", color: "text-amber-300" },
};

export function CompareView({
  scenario,
  baseline,
  latest,
  overrides,
}: {
  scenario: Scenario;
  baseline: Run;
  latest?: Run;
  overrides: Override[];
}) {
  if (!latest) {
    return <p className="text-zinc-300">Rerun to compare.</p>;
  }
  const c = compareRuns(baseline, latest);
  const metas = (
    <div className="grid gap-3 md:grid-cols-2">
      <RunMeta run={baseline} title="Baseline run" />
      <RunMeta run={latest} title="Latest run" />
    </div>
  );
  if (!c.compatible) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-zinc-600 p-4 text-zinc-300">
          <p className="font-semibold text-zinc-100">Not comparable: {c.reason}</p>
          <p>This is not an evaluation result.</p>
        </div>
        {metas}
      </div>
    );
  }
  const baseOverrides = latestOverrides(overrides, baseline.id);
  const latestOv = latestOverrides(overrides, latest.id);
  const titleOf = (id: string) => scenario.checks.find((x) => x.id === id)?.title ?? id;
  return (
    <div className="space-y-3">
      <p className="text-lg font-semibold text-zinc-100">
        {c.summary.improved} improved · {c.summary.regressed} regressed · {c.summary.unchanged} unchanged · {c.summary.inconclusive}{" "}
        inconclusive
      </p>
      {c.instructionUnchanged && (
        <p className="text-zinc-300">Instruction unchanged; differences (if any) are not attributable to the edit.</p>
      )}
      <p className="text-sm text-zinc-400">
        Classification uses the automated results only. Each run is a single sample. A pass means only that the displayed checks passed.
      </p>
      {metas}
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-left text-sm">
          <caption className="px-4 py-2 text-left text-sm text-zinc-400">
            Per-check comparison of the baseline run and the latest run. Human review notes are shown but never change the classification.
          </caption>
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400">
              <th scope="col" className="px-4 py-2 font-medium">Check</th>
              <th scope="col" className="px-4 py-2 font-medium">Version</th>
              <th scope="col" className="px-4 py-2 font-medium">Baseline</th>
              <th scope="col" className="px-4 py-2 font-medium">Latest</th>
              <th scope="col" className="px-4 py-2 font-medium">Change</th>
              <th scope="col" className="px-4 py-2 font-medium">Human review</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => {
              const k = `${r.checkId}/${r.variant}`;
              const cls = CLASS_TEXT[r.classification];
              const notes = [
                baseOverrides.get(k) ? `Baseline: human ${statusLabel(baseOverrides.get(k)!.humanStatus)}` : null,
                latestOv.get(k) ? `Latest: human ${statusLabel(latestOv.get(k)!.humanStatus)}` : null,
              ].filter(Boolean);
              return (
                <tr key={k} className="border-b border-zinc-800/60 last:border-0">
                  <th scope="row" className="px-4 py-2 font-medium text-zinc-200">
                    {titleOf(r.checkId)}
                  </th>
                  <td className="px-4 py-2 text-zinc-300">{variantLabel(scenario, r.variant)}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={r.before} />
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={r.after} />
                  </td>
                  <td className={`px-4 py-2 font-medium ${cls.color}`}>
                    <span aria-hidden="true">{cls.icon} </span>
                    {cls.label}
                  </td>
                  <td className="px-4 py-2 text-zinc-300">{notes.length > 0 ? notes.join("; ") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
