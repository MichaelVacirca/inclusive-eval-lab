import type { Metadata } from "next";
import { runScenario } from "../../lib/lab/run";
import { scenarios } from "../../lib/lab/scenarios";
import { SIMULATED_CONFIG, SIMULATOR_VERSION, simulatedResponder } from "../../lib/lab/simulator";
import { LabClient } from "./lab-client";

export const metadata: Metadata = {
  title: "Evaluation Lab — InclusiveCode",
  description:
    "Inspect paired synthetic LGBTQIA+ scenarios, review evidence-backed findings, edit the system instruction, rerun, and compare. A simulated demo with fictional data.",
};

// Fixed ID and timestamp: nothing time- or random-dependent runs during server render.
const BASELINE_CREATED_AT = "2026-10-05T00:00:00.000Z";

export default async function LabPage() {
  const baselineRuns = await Promise.all(
    scenarios.map((s) =>
      runScenario(s, s.baselineInstruction, simulatedResponder, SIMULATED_CONFIG, {
        id: `${s.id}-baseline`,
        createdAt: BASELINE_CREATED_AT,
        mode: "simulated",
        responderVersion: SIMULATOR_VERSION,
      }),
    ),
  );
  return <LabClient baselineRuns={baselineRuns} />;
}
