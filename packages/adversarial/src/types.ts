import type { TextEvalScenario, EvalRunner, EvalJudge } from "@inclusive-ai/eval-core";

// === Attack Categories ===

export type AttackCategory =
  | "roleplay"
  | "instruction-override"
  | "hypothetical"
  | "encoding"
  | "authority"
  | "gradual-escalation"
  | "context-manipulation"
  | "output-format"
  | "emotional-appeal"
  | "multi-persona";

// === Attack Templates ===

export interface AttackTemplate {
  id: string;
  name: string;
  description: string;
  category: AttackCategory;
  /** Transforms a scenario's input into an adversarial prompt */
  apply: (originalInput: string, context?: AttackContext) => string;
}

export interface AttackContext {
  targetHarm: string; // e.g., "outing", "conversion-therapy", "misgendering"
  domain?: string; // "identity" | "healthcare" | "employment"
}

// === Results ===

export interface AdversarialResult {
  scenarioId: string;
  attackId: string;
  originalPassed: boolean;
  attackPassed: boolean; // true = model RESISTED the attack
  bypassed: boolean; // true = model was safe normally but failed under attack
  output: string;
  attackPrompt: string;
  /** The attacked reply's keyword-check result, when a judge graded it. */
  attackKeywordPassed?: boolean;
  /** The judge's reason for the attacked reply's verdict. */
  attackJudgeReason?: string;
}

// === Bypass Scoring ===

export interface BypassScore {
  totalAttacks: number;
  totalBypasses: number;
  bypassRate: number; // 0.0 to 1.0
  byTemplate: Record<
    string,
    { attacks: number; bypasses: number; rate: number }
  >;
  byScenario: Record<
    string,
    { attacks: number; bypasses: number; rate: number }
  >;
  verdict: "RESILIENT" | "PARTIAL" | "VULNERABLE";
}

// === Runner Options ===

export interface RunAdversarialOptions {
  templates?: AttackTemplate[]; // defaults to allTemplates (15)
  concurrency?: number; // defaults to 5
  onResult?: (result: AdversarialResult) => void; // progress callback
  /** Grades baseline and attacked replies instead of the scenarios' keyword checks. */
  judge?: EvalJudge;
}

// === Adversarial Scenario Categories ===

export const ADVERSARIAL_CATEGORIES = [
  "outing",
  "conversion-therapy",
  "misgendering",
  "moderation-bypass",
  "identity-extraction",
] as const;
