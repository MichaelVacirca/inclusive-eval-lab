#!/usr/bin/env node

import { runEval } from "@inclusive-ai/eval-core";
import { allScenarios, domains } from "./index";
import { CliReporter, JsonReporter, SarifReporter } from "@inclusive-ai/eval-core";
import type { EvalJudge, TextEvalScenario } from "@inclusive-ai/eval-core";
import { checkOutputPath, writeJsonReport } from "./output-file";
import {
  DEFAULT_ANTHROPIC_JUDGE_MODEL,
  DEFAULT_OPENAI_JUDGE_MODEL,
  createAnthropicJudge,
  createOpenAIJudge,
} from "./judges";

async function main() {
  const args = process.argv.slice(2);

  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const hasFlag = (flag: string): boolean => args.includes(flag);

  const systemPrompt = getArg("--system");
  const categoryFilter = getArg("--category")?.split(",");
  const domainFilter = getArg("--domain");
  const severityFilter = getArg("--severity")?.split(",");
  const format = getArg("--format") ?? "cli";
  const useAdversarial = hasFlag("--adversarial");
  const useRedTeam = hasFlag("--red-team");
  const concurrencyRaw = getArg("--concurrency");
  const concurrency = concurrencyRaw ? parseInt(concurrencyRaw, 10) : 5;
  const model = getArg("--model") ?? "claude-haiku-4-5-20251001";
  // --output <file> also writes the JSON report (with each model reply) to a file
  const outputPath = getArg("--output");
  if (hasFlag("--output")) {
    const outputError = checkOutputPath(outputPath);
    if (outputError) {
      console.error(outputError);
      process.exit(1);
    }
  }
  const saveJsonReport = (json: string) => {
    if (!outputPath) return;
    writeJsonReport(outputPath, json);
    // stderr, so the note does not mix into the report on stdout
    console.error(`JSON report written to ${outputPath}`);
  };
  // --judge grades each reply with an LLM judge instead of the keyword check;
  // --judge-model <id> picks the judge model and implies --judge
  const judgeModelArg = getArg("--judge-model");
  if (hasFlag("--judge-model") && (!judgeModelArg || judgeModelArg.startsWith("--"))) {
    console.error("--judge-model needs a model ID, e.g. --judge-model claude-opus-5-5");
    process.exit(1);
  }
  const useJudge = hasFlag("--judge") || hasFlag("--judge-model");

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Set ANTHROPIC_API_KEY or OPENAI_API_KEY");
    process.exit(1);
  }

  // --adversarial and --red-team are mutually exclusive
  if (useAdversarial && useRedTeam) {
    console.error("--adversarial and --red-team are mutually exclusive. Use one at a time.");
    process.exit(1);
  }

  // Resolve --domain to its categories
  let resolvedCategories: string[] | undefined = categoryFilter;
  if (domainFilter) {
    const domain = domains.find((d) => d.id === domainFilter);
    if (!domain) {
      console.error(
        `Unknown domain "${domainFilter}". Available domains: ${domains.map((d) => d.id).join(", ")}`,
      );
      process.exit(1);
    }
    // Combine domain categories with any explicit --category filters
    const domainCategories = domain.categories;
    if (categoryFilter) {
      // Intersection: only categories that are both in the domain and explicitly requested
      resolvedCategories = categoryFilter.filter((c) => domainCategories.includes(c));
    } else {
      resolvedCategories = domainCategories;
    }
  }

  const isOpenAI = !!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY;

  let runner: { call: (prompt: string) => Promise<string>; systemPrompt?: string };

  if (isOpenAI) {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI();
    const openaiModel = model === "claude-haiku-4-5-20251001" ? "gpt-4o-mini" : model;

    console.log(`Provider: OpenAI (${openaiModel})`);

    runner = {
      call: async (prompt: string) => {
        const messages: any[] = [];
        if (systemPrompt) {
          messages.push({ role: "system", content: systemPrompt });
          messages.push({ role: "user", content: prompt });
        } else {
          messages.push({ role: "user", content: prompt });
        }
        const response = await client.chat.completions.create({
          model: openaiModel,
          max_tokens: 512,
          messages,
        });
        return response.choices[0]?.message?.content ?? "";
      },
      systemPrompt,
    };
  } else if (process.env.ANTHROPIC_API_KEY) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();

    console.log(`Provider: Anthropic (${model})`);

    runner = {
      call: async (prompt: string) => {
        const response = await client.messages.create({
          model,
          max_tokens: 512,
          messages: [{ role: "user", content: prompt }],
        });
        return response.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
      },
      systemPrompt,
    };
  } else {
    console.error("Set ANTHROPIC_API_KEY or OPENAI_API_KEY");
    process.exit(1);
  }

  let judge: EvalJudge | undefined;
  if (useJudge) {
    const judgeModel =
      judgeModelArg ?? (isOpenAI ? DEFAULT_OPENAI_JUDGE_MODEL : DEFAULT_ANTHROPIC_JUDGE_MODEL);
    judge = isOpenAI ? await createOpenAIJudge(judgeModel) : await createAnthropicJudge(judgeModel);
    console.log(`Judge: ${isOpenAI ? "OpenAI" : "Anthropic"} (${judgeModel})`);
  }

  // ── --red-team: wrap selected domain scenarios with all 15 attack templates ──
  if (useRedTeam) {
    const { runAdversarial, computeBypassScore, AdversarialReporter, allTemplates } =
      await import("@inclusive-ai/adversarial");

    // Determine which scenarios to red-team
    let targetScenarios: TextEvalScenario[];
    if (domainFilter || resolvedCategories) {
      targetScenarios = allScenarios.filter((s) =>
        resolvedCategories ? resolvedCategories.includes(s.category as string) : true,
      );
    } else {
      targetScenarios = allScenarios;
    }

    console.log(`Running red-team: ${targetScenarios.length} scenarios × ${allTemplates.length} templates`);
    console.log(`= ${targetScenarios.length * allTemplates.length} attacks + ${targetScenarios.length} baselines`);
    if (judge) {
      console.log(`Judge calls: ${targetScenarios.length * (allTemplates.length + 1)} (one per attack and baseline)`);
    }
    if (concurrencyRaw) {
      console.log(`Concurrency: ${concurrency}`);
    }

    const results = await runAdversarial(runner, targetScenarios, {
      templates: allTemplates,
      concurrency,
      judge,
      onResult: (r) => {
        if (r.bypassed) {
          const why = r.attackJudgeReason ? ` (Judge: ${r.attackJudgeReason})` : "";
          console.log(`  [BYPASS] ${r.scenarioId} via ${r.attackId}${why}`);
        }
      },
    });

    const score = computeBypassScore(results);
    const reporter = new AdversarialReporter();

    const output = format === "json"
      ? reporter.reportJson(score)
      : reporter.reportCli(score);

    console.log(output);
    saveJsonReport(reporter.reportJson(score));
    process.exit(score.verdict === "VULNERABLE" ? 1 : 0);
    return;
  }

  // ── --adversarial: run 30 standalone adversarial scenarios via normal runEval ──
  if (useAdversarial) {
    const { adversarialScenarios } = await import("@inclusive-ai/adversarial");

    // Apply category/severity filters if provided
    let filteredScenarios: TextEvalScenario[] = adversarialScenarios as TextEvalScenario[];
    if (resolvedCategories) {
      filteredScenarios = filteredScenarios.filter((s) =>
        resolvedCategories!.includes(s.category as string),
      );
    }

    console.log(`Running ${filteredScenarios.length} adversarial scenarios...`);
    if (resolvedCategories) {
      console.log(`Category filter: ${resolvedCategories.join(", ")}`);
    }

    const summary = await runEval(runner, filteredScenarios, {
      severities: severityFilter,
      judge,
    });

    const reporter =
      format === "json" ? new JsonReporter() :
      format === "sarif" ? new SarifReporter() :
      new CliReporter();

    console.log(reporter.report(summary.results, summary));
    saveJsonReport(new JsonReporter().report(summary.results, summary));
    process.exit(summary.verdict === "FAIL" ? 1 : 0);
    return;
  }

  // ── Default: run domain scenarios (existing behavior) ──
  const scenarios: TextEvalScenario[] = allScenarios;

  console.log(`Running ${scenarios.length} scenarios...`);
  if (domainFilter) {
    console.log(`Domain filter: ${domainFilter}`);
  }
  if (resolvedCategories) {
    console.log(`Category filter: ${resolvedCategories.join(", ")}`);
  }

  const summary = await runEval(runner, scenarios, {
    categories: resolvedCategories,
    severities: severityFilter,
    judge,
  });

  const reporter =
    format === "json" ? new JsonReporter() :
    format === "sarif" ? new SarifReporter() :
    new CliReporter();

  console.log(reporter.report(summary.results, summary));
  saveJsonReport(new JsonReporter().report(summary.results, summary));
  process.exit(summary.verdict === "FAIL" ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
