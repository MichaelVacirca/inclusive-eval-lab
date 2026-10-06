// === Categories ===

/** Open string type with known values for autocomplete */
export type ScenarioCategory = string;

export const KNOWN_CATEGORIES = [
  // identity domain (original)
  "identity",
  "moderation",
  "mental-health",
  "system-prompt",
  "output-safety",
  "privacy",
  // healthcare domain
  "transition-care",
  "mental-health-intake",
  "reproductive-health",
  "provider-matching",
  "medical-records",
  // education domain
  "content-filtering",
  "student-ai",
  "administrative-ai",
  "research-tools",
  // employment domain
  "resume-screening",
  "interview-ai",
  "workplace-tools",
  // content platforms domain
  "recommendation",
  "search-ranking",
  "moderation-parity",
  "advertising",
  "content-generation",
] as const;

// === Severity ===

export type Severity = "critical" | "high" | "medium" | "low";

// === Scenario types by modality ===

/** Base fields shared by all scenario types */
interface ScenarioBase {
  id: string;
  title: string;
  category: ScenarioCategory;
  severity: Severity;
  redFlags?: string[];
  tags?: string[];
}

/** Text scenario (backwards-compatible with v1 EvalScenario) */
export interface TextEvalScenario extends ScenarioBase {
  modality: "text";
  /** Human-readable description (v1 compat — same value as title) */
  description: string;
  input: string;
  pass: (output: string) => boolean;
  failMessage: string;
  patternUrl?: string;
}

/** Image generation scenario */
export interface ImageEvalScenario extends ScenarioBase {
  modality: "image";
  prompt: string;
  pass: (imageUrl: string, metadata: ImageMetadata) => Promise<boolean>;
}

export interface ImageMetadata {
  altText?: string;
  labels?: string[];
  safetyAnnotations?: Record<string, number>;
}

/** Embedding bias scenario */
export interface EmbeddingEvalScenario extends ScenarioBase {
  modality: "embedding";
  termPairs: Array<{
    term: string;
    shouldNotBeCloseTo: string[];
    threshold: number;
  }>;
  pass: (distances: Record<string, number>) => boolean;
}

/** Multi-turn conversation scenario */
export interface MultiTurnEvalScenario extends ScenarioBase {
  modality: "multi-turn";
  turns: Array<{ role: "user" | "system"; content: string }>;
  pass: (responses: string[]) => boolean;
}

/** Pipeline/RAG scenario */
export interface PipelineEvalScenario extends ScenarioBase {
  modality: "pipeline";
  query: string;
  context?: string;
  pass: (output: string, retrievedDocs?: string[]) => boolean;
}

/** Discriminated union of all scenario types */
export type AnyEvalScenario =
  | TextEvalScenario
  | ImageEvalScenario
  | EmbeddingEvalScenario
  | MultiTurnEvalScenario
  | PipelineEvalScenario;

// === V1 compat aliases ===

/** @deprecated Use TextEvalScenario */
export type EvalScenario = TextEvalScenario;

// === Runner types ===

/** V1-compatible runner interface for text-only eval */
export interface EvalRunner {
  call: (prompt: string) => Promise<string>;
  systemPrompt?: string;
}

/** A judge's decision on one reply. */
export interface JudgeVerdict {
  passed: boolean;
  /** One sentence on why, quoting the decisive part of the reply. */
  reason: string;
}

/**
 * Grades a reply against the scenario's intent (its title and failMessage)
 * instead of its keyword check. Returns undefined when it cannot give a verdict
 * (for example, the judge model declined); the keyword result is then kept.
 */
export interface EvalJudge {
  grade(scenario: TextEvalScenario, output: string): Promise<JudgeVerdict | undefined>;
}

// === Result types ===

export interface EvalResult {
  scenarioId: string;
  category: ScenarioCategory;
  severity: Severity;
  title: string;
  /** @deprecated Use `title` — kept for v1 compat */
  description: string;
  passed: boolean;
  output: string;
  failMessage?: string;
  patternUrl?: string;
  /** What decided `passed`: the scenario's keyword check or a judge. Set when a judge ran. */
  gradedBy?: "keyword" | "judge";
  /** The keyword check's own result, kept when a judge ran. */
  keywordPassed?: boolean;
  /** The judge's reason, or why there is no judge verdict. */
  judgeReason?: string;
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  bySeverity: Record<string, { passed: number; failed: number }>;
  byCategory: Record<string, { passed: number; failed: number }>;
  verdict: "PASS" | "NEEDS_WORK" | "FAIL";
  results: EvalResult[];
}

// === Adapter types ===

export interface EvalContext {
  timeout?: number;
  concurrency?: number;
}

export interface EvalAdapter<T extends AnyEvalScenario = AnyEvalScenario> {
  modality: T["modality"];
  run(scenario: T, context: EvalContext): Promise<EvalResult>;
}

// === Reporter types ===

export type ReporterFormat = "cli" | "json" | "sarif";

export interface EvalReporter {
  format: ReporterFormat;
  report(results: EvalResult[], summary: EvalSummary): string;
}

// === Domain Definition ===

import type { AntiPattern } from "./patterns/registry";
export type { AntiPattern } from "./patterns/registry";

export interface DomainDefinition {
  id: string;
  version: string;
  name: string;
  description: string;
  categories: string[];
  scenarios: AnyEvalScenario[];
  antiPatterns: AntiPattern[];
}
