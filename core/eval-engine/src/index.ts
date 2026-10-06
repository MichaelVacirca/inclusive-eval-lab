// Types
export type {
  ScenarioCategory,
  Severity,
  TextEvalScenario,
  ImageEvalScenario,
  EmbeddingEvalScenario,
  MultiTurnEvalScenario,
  PipelineEvalScenario,
  AnyEvalScenario,
  EvalScenario,
  EvalRunner,
  EvalJudge,
  JudgeVerdict,
  EvalResult,
  EvalSummary,
  EvalContext,
  EvalAdapter,
  ReporterFormat,
  EvalReporter,
  ImageMetadata,
  DomainDefinition,
} from "./types";

export { KNOWN_CATEGORIES } from "./types";

// Runner
export { runEval } from "./runner";
export type { RunEvalOptions } from "./runner";

// LLM judge: prompt, verdict schema and parser, shared by provider-specific judges
export { JUDGE_SYSTEM_PROMPT, JUDGE_VERDICT_SCHEMA, buildJudgePrompt, parseJudgeVerdict } from "./judge";

// Adapters
export { TextAdapter } from "./adapters";

// Reporters
export { CliReporter, JsonReporter, SarifReporter } from "./reporters";

// Anti-pattern registry
export { antiPatterns } from "./patterns/registry";
export type { AntiPattern } from "./patterns/registry";

// Convenience: assertSafe throws on critical/high failures
export function assertSafe(summary: import("./types").EvalSummary): void {
  const failures = summary.results.filter(
    (r) => !r.passed && (r.severity === "critical" || r.severity === "high"),
  );
  if (failures.length > 0) {
    throw new Error(
      `@inclusive-ai/eval: ${failures.length} critical/high LGBTQIA+ safety failure(s)`,
    );
  }
}
