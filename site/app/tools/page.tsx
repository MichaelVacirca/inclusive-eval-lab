import Link from "next/link";

const tools = [
  {
    id: "eval",
    name: "Eval Suite",
    tagline: "200 safety scenarios + adversarial red-teaming for your LLM",
    install: "npm install --save-dev @inclusive-ai/eval",
    description:
      "A TypeScript eval framework that tests your LLM for LGBTQIA+-specific failure modes. Covers 5 domains: identity, healthcare, employment, education, and content platforms — 170 runnable safety scenarios. Integrates with any test runner. Includes 30 adversarial jailbreak scenarios and a red-team harness that wraps any scenario with 15 attack templates to test prompt resilience.",
    usage: `import { runEval, printSummary, assertSafe } from "@inclusive-ai/eval";

const summary = await runEval({
  systemPrompt: "You are a helpful assistant...",
  call: async (prompt) => yourLLM.complete(prompt),
});

printSummary(summary);
assertSafe(summary); // throws on CRITICAL or HIGH failures`,
    cli: `# Run all 200 scenarios
ANTHROPIC_API_KEY=sk-... npx inclusive-eval

# Filter by category or severity
inclusive-eval --category identity,moderation
inclusive-eval --severity critical

# Run by domain
inclusive-eval --domain education
inclusive-eval --domain content

# Run 30 adversarial jailbreak scenarios
inclusive-eval --adversarial

# Red-team healthcare scenarios with 15 attack templates
inclusive-eval --red-team --domain healthcare`,
    categories: [
      { name: "Identity", count: 5, examples: "pronoun inference, deadnaming, partner gender" },
      { name: "Mental Health", count: 4, examples: "coming-out, crisis resources, conversion language" },
      { name: "Moderation", count: 4, examples: "same-sex parity, identity disclosure, Pride content" },
      { name: "System Prompt", count: 3, examples: "heteronormative defaults, gendered employees" },
      { name: "Output Safety", count: 5, examples: "outing risk, identity speculation, biphobia" },
      { name: "Privacy", count: 3, examples: "orientation tracking, cross-context linkage" },
      { name: "Intersectionality", count: 12, examples: "race+orientation, disability+gender, religion+identity" },
      { name: "Cultural Context", count: 12, examples: "regional norms, language localization, non-Western identities" },
      { name: "Temporal Identity", count: 12, examples: "transition timelines, name history, pronoun changes" },
      { name: "Transition Care", count: 7, examples: "triage deprioritization, insurance denial, affirming care" },
      { name: "Mental Health Intake", count: 6, examples: "pathologizing identity, minority stress, conversion referrals" },
      { name: "Reproductive Health", count: 6, examples: "anatomy inference, same-sex fertility exclusion" },
      { name: "Provider Matching", count: 5, examples: "non-affirming routing, outing during referral" },
      { name: "Medical Records", count: 6, examples: "deadname exposure, transition history, record linkage" },
      { name: "Resume Screening", count: 10, examples: "name-gender inference, gap penalization, org bias" },
      { name: "Interview AI", count: 7, examples: "identity-fishing questions, presentation bias" },
      { name: "Workplace Tools", count: 8, examples: "same-sex benefits, culture fit, HR chatbots" },
      { name: "Content Filtering", count: 7, examples: "educational content censorship, book filtering, essay flagging" },
      { name: "Student AI", count: 6, examples: "pronoun misgendering, both-sides framing, heteronormative prompts" },
      { name: "Administrative AI", count: 6, examples: "binary enrollment, outing in letters, GSA penalization" },
      { name: "Research Tools", count: 6, examples: "LGBTQIA+ erasure in summaries, citation bias, knowledge graphs" },
      { name: "Recommendation", count: 8, examples: "creator suppression, shadow-banning, search autocomplete bias" },
      { name: "Moderation Parity", count: 8, examples: "same-sex affection flagging, trans body misclassification" },
      { name: "Advertising", count: 7, examples: "housing/employment exclusion, orientation targeting, predatory ads" },
      { name: "Content Generation", count: 7, examples: "heteronormative defaults, pronoun changes, coming-out trauma" },
    ],
  },
  {
    id: "plugin",
    name: "Claude Code Plugin",
    tagline: "Real-time safety review as you code",
    install: "cp plugin/commands/lgbt-audit.md .claude/commands/",
    description:
      "A Claude Code plugin with two components: a /lgbt-audit slash command that runs a full scored audit on any project, and an auto-triggered skill that flags anti-patterns in real-time as you write or review code involving identity, moderation, or crisis flows.",
    usage: `# Run a full audit
/lgbt-audit

# Audit specific files
/lgbt-audit src/prompts/
/lgbt-audit src/models/user.ts`,
    features: [
      "/lgbt-audit command — full project audit with scored report",
      "Auto-review skill — flags anti-patterns as you code",
      "43 anti-pattern detections across 4 severity levels",
      "Paste-ready fixes with regression test suggestions",
      "/lgbt-red-team command for adversarial bypass scoring",
    ],
  },
  {
    id: "action",
    name: "GitHub Action",
    tagline: "LGBTQIA+ safety checks in your CI pipeline",
    install: "# Add to .github/workflows/safety.yml",
    description:
      "A reusable GitHub Action that runs the full eval suite against your system prompts on every push or pull request. Fails the build when critical safety issues are detected.",
    usage: `name: LGBTQIA+ Safety
on: [push, pull_request]
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: InclusiveCode/inclusive-ai/action@main
        with:
          anthropic-api-key: \${{ secrets.ANTHROPIC_API_KEY }}
          system-prompt: "Your system prompt here"
          severity: critical,high`,
    features: [
      "Runs all 200 eval scenarios in CI",
      "Configurable severity threshold and category filters",
      "System prompt testing against real LLM calls",
      "Clear failure output with links to pattern docs",
      "Adversarial red-team mode with bypass scoring",
    ],
  },
  {
    id: "hook",
    name: "Pre-Commit Hook",
    tagline: "Catch anti-patterns before they land",
    install: `cp hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit`,
    description:
      "A bash pre-commit hook that scans staged files for common LGBTQIA+ safety anti-patterns using regex pattern matching. Blocks commits with critical issues and warns on high-severity patterns. Zero dependencies.",
    usage: `# With husky
npx husky add .husky/pre-commit \\
  "bash $(npm root)/@inclusive-ai/eval/hooks/pre-commit"`,
    detects: [
      { pattern: 'gender: "male" | "female"', severity: "CRITICAL" },
      { pattern: "isMale / isFemale booleans", severity: "CRITICAL" },
      { pattern: "inferGender / genderFromName", severity: "CRITICAL" },
      { pattern: "Conversion therapy language", severity: "CRITICAL" },
      { pattern: "he/she in prompts", severity: "WARNING" },
      { pattern: "husband/wife in prompts", severity: "WARNING" },
      { pattern: "email.split('@') as display name", severity: "WARNING" },
      { pattern: "Gendered greetings (sir/ma'am)", severity: "WARNING" },
    ],
  },
  {
    id: "claude-md",
    name: "CLAUDE.md Template",
    tagline: "Always-on safety context for every session",
    install: "cp templates/CLAUDE.md .claude/CLAUDE.md",
    description:
      "A drop-in project context file that makes Claude automatically apply LGBTQIA+ safety rules when writing or reviewing code. Claude will flag anti-patterns, suggest inclusive alternatives, and remind you to add eval coverage — every session, without being asked.",
    features: [
      "Auto-flags binary gender enums, he/she prompts, deadnaming risks",
      "Enforces inclusive prompt design (partner/spouse, they/them)",
      "Requires LGBTQIA+ crisis resources in mental health flows",
      "Checks moderation parity on every moderation prompt",
      "Suggests @inclusive-ai/eval scenarios when reviewing evals",
    ],
  },
];

export default function ToolsPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-20">
      <div className="mb-12">
        <div className="inline-block px-3 py-1 rounded-full bg-zinc-800 text-zinc-400 text-xs font-mono mb-4">
          developer tools
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
          <span style={{ background: "linear-gradient(90deg, #FF6B9D, #FF9B71, #FECF6A, #63E6BE, #74B9FF, #A29BFE)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Ship Safer With Every Commit</span>
        </h1>
        <p className="text-lg text-zinc-400 max-w-2xl">
          Drop these into your dev pipeline. Eval suite for CI, Claude plugin for
          code review, pre-commit hook for fast catches, and always-on project
          context.
        </p>
      </div>

      {/* Evaluation Lab */}
      <div className="mb-12 p-6 border border-zinc-800 rounded-xl bg-zinc-900/50">
        <h2 className="text-xl font-bold mb-2">Evaluation Lab</h2>
        <p className="text-zinc-400 mb-4">
          Try the workflow in your browser: inspect paired LGBTQIA+ scenarios, see evidence-backed findings, edit the
          system instruction, rerun, and compare. Simulated demo with fictional data; no setup needed.
        </p>
        <Link
          href="/lab"
          className="inline-flex items-center gap-2 px-4 py-2 border border-zinc-700 rounded-lg text-sm hover:border-zinc-500 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          Open the Evaluation Lab
        </Link>
      </div>

      {/* Quick nav */}
      <div className="flex flex-wrap gap-2 mb-12">
        {tools.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            className="px-3 py-1.5 text-sm border border-zinc-700 rounded-lg hover:border-zinc-500 transition-colors"
          >
            {t.name}
          </a>
        ))}
      </div>

      <div className="space-y-16">
        {tools.map((tool) => (
          <section key={tool.id} id={tool.id} className="scroll-mt-20">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-2xl font-bold">{tool.name}</h2>
                <p className="text-zinc-400">{tool.tagline}</p>
              </div>
            </div>

            <p className="text-zinc-300 mb-6">{tool.description}</p>

            {/* Install */}
            <div className="mb-6">
              <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-2">
                Install
              </h3>
              <pre className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-sm overflow-x-auto">
                <code className="text-green-400">{tool.install}</code>
              </pre>
            </div>

            {/* Usage */}
            {tool.usage && (
              <div className="mb-6">
                <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-2">
                  Usage
                </h3>
                <pre className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-sm overflow-x-auto">
                  <code className="text-zinc-300">{tool.usage}</code>
                </pre>
              </div>
            )}

            {/* CLI (eval only) */}
            {"cli" in tool && tool.cli && (
              <div className="mb-6">
                <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-2">
                  CLI
                </h3>
                <pre className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-sm overflow-x-auto">
                  <code className="text-zinc-300">{tool.cli}</code>
                </pre>
              </div>
            )}

            {/* Categories (eval only) */}
            {"categories" in tool && tool.categories && (
              <div className="mb-6">
                <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-2">
                  Scenario Categories
                </h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  {tool.categories.map((cat) => (
                    <div
                      key={cat.name}
                      className="p-3 border border-zinc-800 rounded-lg"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">{cat.name}</span>
                        <span className="text-xs font-mono text-zinc-500">
                          {cat.count} scenarios
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500">{cat.examples}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Features */}
            {"features" in tool && tool.features && (
              <div className="mb-6">
                <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-2">
                  Features
                </h3>
                <ul className="space-y-2">
                  {tool.features.map((f, i) => (
                    <li key={i} className="flex gap-2 text-sm text-zinc-300">
                      <span className="text-green-400 shrink-0">+</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Detects (hook only) */}
            {"detects" in tool && tool.detects && (
              <div className="mb-6">
                <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-2">
                  What It Catches
                </h3>
                <div className="border border-zinc-800 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800">
                        <th className="text-left px-4 py-2 text-xs font-mono text-zinc-500">
                          Pattern
                        </th>
                        <th className="text-right px-4 py-2 text-xs font-mono text-zinc-500">
                          Severity
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {tool.detects.map((d, i) => (
                        <tr
                          key={i}
                          className="border-b border-zinc-800/50 last:border-0"
                        >
                          <td className="px-4 py-2 text-zinc-300">
                            <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded">
                              {d.pattern}
                            </code>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <span
                              className={`text-xs font-mono ${
                                d.severity === "CRITICAL"
                                  ? "text-red-400"
                                  : "text-yellow-400"
                              }`}
                            >
                              {d.severity}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        ))}
      </div>

      {/* CTA */}
      <div className="mt-16 p-8 border border-zinc-800 rounded-xl bg-zinc-900/50 text-center">
        <h2 className="text-xl font-bold mb-2">All tools. One repo.</h2>
        <p className="text-zinc-400 mb-4">
          Everything is MIT licensed and open source.
        </p>
        <a
          href="https://github.com/InclusiveCode/inclusive-ai"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-6 py-3 bg-zinc-100 text-zinc-900 rounded-lg font-medium hover:bg-white transition-colors"
        >
          View on GitHub
        </a>
      </div>
    </div>
  );
}
