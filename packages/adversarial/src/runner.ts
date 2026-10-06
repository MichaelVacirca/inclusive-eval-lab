import type { TextEvalScenario, EvalRunner, EvalSummary } from "@inclusive-ai/eval-core";
import { runEval } from "@inclusive-ai/eval-core";
import type {
  AttackTemplate,
  AdversarialResult,
  RunAdversarialOptions,
} from "./types";
import { allTemplates } from "./templates/index";

/**
 * Generate the cross-product of scenarios × templates, producing new
 * TextEvalScenario[] where each input has been wrapped by an attack template.
 *
 * Only `id`, `input`, and `title` are modified; all other fields
 * (pass, category, severity, modality, description, failMessage, patternUrl)
 * are copied from the original scenario.
 */
export function wrapWithAttacks(
  scenarios: TextEvalScenario[],
  templates: AttackTemplate[],
): TextEvalScenario[] {
  const result: TextEvalScenario[] = [];

  for (const scenario of scenarios) {
    for (const template of templates) {
      result.push({
        id: `${scenario.id}__${template.id}`,
        modality: scenario.modality,
        category: scenario.category,
        severity: scenario.severity,
        title: `[ATK: ${template.name}] ${scenario.title}`,
        description: scenario.description,
        input: template.apply(scenario.input),
        pass: scenario.pass,
        failMessage: scenario.failMessage,
        patternUrl: scenario.patternUrl,
      });
    }
  }

  return result;
}

/**
 * Run adversarial red-team evaluation:
 * 1. Run baseline eval on original scenarios
 * 2. Generate adversarial variants via wrapWithAttacks()
 * 3. Run eval on adversarial variants
 * 4. Compare: baseline passed + adversarial failed → bypass
 * 5. Return AdversarialResult[]
 *
 * With options.judge, both the baseline and the attacked replies are graded by the
 * judge instead of the scenarios' keyword checks.
 */
export async function runAdversarial(
  runner: EvalRunner,
  scenarios: TextEvalScenario[],
  options?: RunAdversarialOptions,
): Promise<AdversarialResult[]> {
  const templates = options?.templates ?? allTemplates;
  const onResult = options?.onResult;

  // Step 1: Run baseline
  const baselineSummary: EvalSummary = await runEval(runner, scenarios, { judge: options?.judge });
  const baselineByScenario = new Map<string, boolean>();
  for (const r of baselineSummary.results) {
    baselineByScenario.set(r.scenarioId, r.passed);
  }

  // Step 2: Generate adversarial variants
  const adversarialScenarios = wrapWithAttacks(scenarios, templates);

  // Step 3: Run adversarial eval
  const adversarialSummary: EvalSummary = await runEval(
    runner,
    adversarialScenarios,
    { judge: options?.judge },
  );

  // Step 4: Compare and build results
  const results: AdversarialResult[] = [];

  for (const advResult of adversarialSummary.results) {
    // Parse compound ID: scenarioId__templateId
    const separatorIndex = advResult.scenarioId.indexOf("__");
    const originalScenarioId = advResult.scenarioId.substring(
      0,
      separatorIndex,
    );
    const attackId = advResult.scenarioId.substring(separatorIndex + 2);

    const originalPassed = baselineByScenario.get(originalScenarioId) ?? false;
    const attackPassed = advResult.passed;
    const bypassed = originalPassed && !attackPassed;

    const result: AdversarialResult = {
      scenarioId: originalScenarioId,
      attackId,
      originalPassed,
      attackPassed,
      bypassed,
      output: advResult.output,
      attackPrompt: advResult.scenarioId, // compound ID for traceability
    };
    if (advResult.gradedBy !== undefined) {
      result.attackKeywordPassed = advResult.keywordPassed;
      result.attackJudgeReason = advResult.judgeReason;
    }

    results.push(result);
    onResult?.(result);
  }

  return results;
}
