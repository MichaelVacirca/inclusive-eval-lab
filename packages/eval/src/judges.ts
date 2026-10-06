import {
  JUDGE_SYSTEM_PROMPT,
  JUDGE_VERDICT_SCHEMA,
  buildJudgePrompt,
  parseJudgeVerdict,
} from "@inclusive-ai/eval-core";
import type { EvalJudge, TextEvalScenario } from "@inclusive-ai/eval-core";

export const DEFAULT_ANTHROPIC_JUDGE_MODEL = "claude-opus-5-5";
export const DEFAULT_OPENAI_JUDGE_MODEL = "gpt-4.1";

function noVerdict(scenario: TextEvalScenario, why: string): undefined {
  console.error(`Judge: ${why} for ${scenario.id}; keeping the keyword result.`);
  return undefined;
}

/**
 * Judge on the Claude API. The verdict is constrained to JUDGE_VERDICT_SCHEMA. If the
 * judge model declines, the API retries on Anthropic's default fallback model for that
 * refusal category (server-side fallbacks), and the reason notes which model graded.
 */
export async function createAnthropicJudge(model: string): Promise<EvalJudge> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { betaJSONSchemaOutputFormat } = await import("@anthropic-ai/sdk/helpers/beta/json-schema");
  const client = new Anthropic();
  // Hand the answer text to parseJudgeVerdict, which returns undefined for anything
  // that is not a verdict. The helper's own parse throws on text that is not JSON,
  // such as an answer cut off at max_tokens, and that would end the whole run.
  const format = { ...betaJSONSchemaOutputFormat(JUDGE_VERDICT_SCHEMA), parse: (text: string) => text };

  return {
    async grade(scenario, output) {
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: JUDGE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildJudgePrompt(scenario, output) }],
        output_config: { effort: "medium", format },
      });
      // A refusal here means the judge model and its fallback both declined.
      if (response.stop_reason === "refusal") return noVerdict(scenario, "the judge declined");
      const verdict = parseJudgeVerdict(response.parsed_output);
      if (!verdict) return noVerdict(scenario, `no usable verdict (stop_reason ${response.stop_reason})`);
      const fellBack = (response.usage.iterations ?? []).some((i) => i.type === "fallback_message");
      return fellBack
        ? { ...verdict, reason: `${verdict.reason} (graded by ${response.model} after ${model} declined)` }
        : verdict;
    },
  };
}

/** Judge on the OpenAI API, with a strict JSON schema response format. */
export async function createOpenAIJudge(model: string): Promise<EvalJudge> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI();

  return {
    async grade(scenario, output) {
      const response = await client.chat.completions.create({
        model,
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: { name: "judge_verdict", strict: true, schema: JUDGE_VERDICT_SCHEMA },
        },
        messages: [
          { role: "system", content: JUDGE_SYSTEM_PROMPT },
          { role: "user", content: buildJudgePrompt(scenario, output) },
        ],
      });
      const message = response.choices[0]?.message;
      if (message?.refusal) return noVerdict(scenario, "the judge declined");
      return (
        parseJudgeVerdict(message?.content ?? "") ?? noVerdict(scenario, "no usable verdict")
      );
    },
  };
}
