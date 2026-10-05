import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
// The CLI prints its verdict with these reporters, so the fixtures below are
// the real output format rather than a copy of it.
import { CliReporter } from "../../core/eval-engine/src/reporters/cli";
import type { EvalResult, EvalSummary } from "../../core/eval-engine/src/types";
import { AdversarialReporter } from "../../packages/adversarial/src/reporter";
import type { BypassScore } from "../../packages/adversarial/src/types";
import {
  INJECTION_PAYLOADS,
  REPO_ROOT,
  type Sandbox,
  allSteps,
  loadYaml,
  makeSandbox,
  resolveEnv,
  runStep,
  stepNamed,
  stubVars,
  withDefaults,
  writeStub,
} from "./harness";

const FILE = "action/action.yml";
const doc = loadYaml(FILE);
const steps = allSteps(doc);
const install = stepNamed(steps, "Install @inclusive-ai/eval");
const runEval = stepNamed(steps, "Run LGBTQIA+ safety eval");
const KEY = "sk-test";

const INSTALLED_CLI = "inclusive-eval/node_modules/.bin/inclusive-eval";
const CLI = stubVars("inclusive-eval");
const ROOT_PKG = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
const SDK = `@anthropic-ai/sdk@${ROOT_PKG.devDependencies["@anthropic-ai/sdk"]}`;

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});

/** Put a stub CLI where the install step would have put the real one. */
function withInstalledCli() {
  writeStub(sb, join(sb.runnerTemp, INSTALLED_CLI), "inclusive-eval");
}

function runInstall(inputs: Record<string, string>, extraEnv: Record<string, string> = {}) {
  const env = resolveEnv(install.env, { inputs: withDefaults(doc.inputs, { "anthropic-api-key": KEY, ...inputs }) });
  return runStep(sb, install, env, extraEnv);
}

function run(inputs: Record<string, string>, extraEnv: Record<string, string> = {}) {
  const env = resolveEnv(runEval.env, { inputs: withDefaults(doc.inputs, { "anthropic-api-key": KEY, ...inputs }) });
  return runStep(sb, runEval, env, extraEnv);
}

/** Run with the stub CLI printing `output` and exiting with `exitCode`. */
function runWithCli(inputs: Record<string, string>, output: string, exitCode = 0) {
  return run(inputs, { [CLI.stdout]: output, [CLI.exit]: String(exitCode) });
}

/** argv of the single CLI call. */
function cliArgs(inputs: Record<string, string>): string[] {
  const r = run(inputs);
  expect(r.status).toBe(0);
  expect(r.calls).toHaveLength(1);
  const [call] = r.calls;
  expect(call.prog).toBe("inclusive-eval");
  return call.argv;
}

/** The line of a step script that sets a variable, e.g. `version_re=...`. */
function assignment(script: string | undefined, name: string): string {
  const line = (script ?? "").split("\n").find((l) => l.trim().startsWith(`${name}=`));
  if (!line) throw new Error(`no ${name}= line`);
  return line.trim();
}

// ── CLI output fixtures, rendered by the real reporters ──

type EvalVerdict = EvalSummary["verdict"];
type RedTeamVerdict = BypassScore["verdict"];

function failure(id: string, severity: EvalResult["severity"]): EvalResult {
  return {
    scenarioId: id,
    category: "identity" as EvalResult["category"],
    severity,
    title: `Title of ${id}`,
    description: `Title of ${id}`,
    passed: false,
    output: "",
    failMessage: `Why ${id} failed`,
    patternUrl: "https://inclusive-ai.vercel.app/patterns",
  };
}

/** What `inclusive-eval` prints for a standard or --adversarial run with this verdict. */
function evalOutput(verdict: EvalVerdict): string {
  const results = [
    ...(verdict === "FAIL" ? [failure("critical-1", "critical")] : []),
    ...(verdict === "PASS" ? [] : [failure("high-1", "high")]),
    failure("medium-1", "medium"),
  ];
  const count = (sev: string) => results.filter((r) => r.severity === sev).length;
  const summary: EvalSummary = {
    total: 10,
    passed: 10 - results.length,
    failed: results.length,
    bySeverity: {
      critical: { passed: 3 - count("critical"), failed: count("critical") },
      high: { passed: 4 - count("high"), failed: count("high") },
      medium: { passed: 3 - count("medium"), failed: count("medium") },
    },
    byCategory: { identity: { passed: 10 - results.length, failed: results.length } },
    verdict,
    results,
  };
  return [
    "Provider: Anthropic (claude-haiku-4-5-20251001)",
    "Running 10 scenarios...",
    new CliReporter().report(results, summary),
    "",
  ].join("\n");
}

/** What `inclusive-eval --red-team` prints with this verdict (10 attacks). */
function redTeamOutput(verdict: RedTeamVerdict): string {
  const bypasses = { RESILIENT: 0, PARTIAL: 2, VULNERABLE: 6 }[verdict];
  const score: BypassScore = {
    totalAttacks: 10,
    totalBypasses: bypasses,
    bypassRate: bypasses / 10,
    byTemplate: { "role-play": { attacks: 10, bypasses, rate: bypasses / 10 } },
    byScenario: { "identity-1": { attacks: 10, bypasses, rate: bypasses / 10 } },
    verdict,
  };
  return [
    "Provider: Anthropic (claude-haiku-4-5-20251001)",
    "Running red-team: 1 scenarios × 10 templates",
    "= 10 attacks + 1 baselines",
    ...Array.from({ length: bypasses }, () => "  [BYPASS] identity-1 via role-play"),
    new AdversarialReporter().reportCli(score),
    "",
  ].join("\n");
}

/** The CLI's own exit code for a verdict (packages/eval/src/cli.ts). */
const CLI_EXIT: Record<EvalVerdict | RedTeamVerdict, number> = {
  PASS: 0,
  NEEDS_WORK: 0,
  FAIL: 1,
  RESILIENT: 0,
  PARTIAL: 0,
  VULNERABLE: 1,
};

function outputFor(verdict: EvalVerdict | RedTeamVerdict): string {
  return verdict === "PASS" || verdict === "NEEDS_WORK" || verdict === "FAIL"
    ? evalOutput(verdict)
    : redTeamOutput(verdict);
}

describe("output fixtures", () => {
  it.each(["PASS", "NEEDS_WORK", "FAIL"] as const)("print the %s summary verdict once", (verdict) => {
    const lines = evalOutput(verdict)
      .split("\n")
      .filter((l) => l.startsWith("Verdict: "));
    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith(` ${verdict}`)).toBe(true);
  });

  it.each(["RESILIENT", "PARTIAL", "VULNERABLE"] as const)("print the %s red-team verdict once", (verdict) => {
    expect(
      redTeamOutput(verdict)
        .split("\n")
        .filter((l) => l.startsWith("Verdict: ")),
    ).toEqual([`Verdict: ${verdict}`]);
  });
});

describe("action definition", () => {
  it("is a composite action", () => {
    expect(doc.runs.using).toBe("composite");
  });

  it("requires only the API key", () => {
    const required = Object.entries(doc.inputs as Record<string, { required?: boolean }>)
      .filter(([, d]) => d.required)
      .map(([n]) => n);
    expect(required).toEqual(["anthropic-api-key"]);
  });

  it("documents the defaults the steps rely on", () => {
    expect(doc.inputs["fail-on"].default).toBe("FAIL");
    expect(doc.inputs.adversarial.default).toBe("false");
    expect(doc.inputs["red-team"].default).toBe("false");
    expect(doc.inputs.concurrency.default).toBe("5");
    expect(doc.inputs["eval-version"].default).toBe("3");
  });

  it("documents what each fail-on value fails on, in both modes", () => {
    const text = doc.inputs["fail-on"].description as string;
    for (const word of ["FAIL", "NEEDS_WORK", "VULNERABLE", "PARTIAL", "red-team"]) expect(text).toContain(word);
  });

  it("sets up Node 26 without automatic package-manager caching in the caller's workspace", () => {
    const setup = stepNamed(steps, "Setup Node.js");
    expect(setup.uses).toBe("actions/setup-node@v7");
    expect(setup.with).toEqual({ "node-version": 26, "package-manager-cache": false });
  });

  it("only exposes the API key to the step that runs the eval", () => {
    for (const s of steps) {
      expect(JSON.stringify(s.env ?? {}).includes("inputs.anthropic-api-key")).toBe(s === runEval);
    }
  });

  it("checks eval-version with the same rule, and pins the same SDK, as the reusable workflow", () => {
    const workflow = stepNamed(allSteps(loadYaml(".github/workflows/lgbt-safety-eval.yml")), "Install the eval CLI");
    for (const name of ["version_re", "tarball_re"]) {
      expect(assignment(install.run, name)).toBe(assignment(workflow.run, name));
    }
    expect(install.run).toContain(`"${SDK}"`);
    expect(workflow.run).toContain(`"${SDK}"`);
  });
});

describe("install step: published versions", () => {
  it.each(["3", "3.2.0", "^3.2.0", "~3.2", "3.x", "latest", "3.2.0-beta.1"])(
    "installs @inclusive-ai/eval@%s into RUNNER_TEMP without install scripts or saving",
    (version) => {
      const r = runInstall({ "eval-version": version });
      expect(r.status).toBe(0);
      expect(r.calls).toEqual([
        {
          prog: "npm",
          argv: [
            "install",
            "--no-save",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--prefix",
            join(sb.runnerTemp, "inclusive-eval"),
            `@inclusive-ai/eval@${version}`,
            SDK,
          ],
          cwd: sb.work,
          apiKeySet: false,
        },
      ]);
      expect(r.created).toEqual([]);
    },
  );

  it("installs major version 3 when no version is passed", () => {
    const r = runInstall({});
    expect(r.status).toBe(0);
    expect(r.calls[0].argv).toContain("@inclusive-ai/eval@3");
  });

  it("pins the SDK to the same range as the repo root", () => {
    expect(SDK).toMatch(/^@anthropic-ai\/sdk@\^?\d/);
    expect(runInstall({}).calls[0].argv.at(-1)).toBe(SDK);
  });

  it("fails the step when npm install fails", () => {
    expect(runInstall({}, { STUB_EXIT_NPM: "1" }).status).toBe(1);
  });
});

describe("install step: malformed versions", () => {
  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["leading space", " 3"],
    ["trailing newline", "3\n"],
    ["a range with spaces", ">= 3"],
    ["a comparator", ">=3"],
    ["a local path", "file:../evil"],
    ["a relative path", "../evil"],
    ["a git URL", "git+https://example.com/evil.git"],
    ["a tarball URL", "https://example.com/evil.tgz"],
    ["an alias", "npm:evil@1"],
    ["another package", "@evil/pkg"],
    ["two versions", "3 4"],
    ["shell metacharacters", "3; touch PWNED"],
    ["command substitution", "$(touch PWNED)"],
    ["the current directory", "."],
    ["the parent directory", ".."],
    ["a dot-prefixed name", ".x"],
    ["a leading dash", "-1"],
    ["a .tgz tarball", "evil.tgz"],
    ["an upper-case .TGZ tarball", "EVIL.TGZ"],
    ["a .tar tarball", "3.2.0-x.tar"],
    ["a .tar.gz tarball", "pkg.tar.gz"],
  ])("rejects %s without calling npm", (_label, version) => {
    const r = runInstall({ "eval-version": version });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.created).toEqual([]);
    expect(r.stdout).toContain("::error::eval-version must be a published version or tag");
  });
});

describe("run step: which CLI runs", () => {
  it("runs the installed CLI from RUNNER_TEMP with the API key", () => {
    withInstalledCli();
    const r = run({});
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([{ prog: "inclusive-eval", argv: [], cwd: sb.work, apiKeySet: true }]);
  });

  it("never falls back to npx, which could fetch a package from the registry", () => {
    withInstalledCli();
    expect(run({}).calls.map((c) => c.prog)).toEqual(["inclusive-eval"]);
  });

  it("fails clearly if the installed CLI is missing", () => {
    const r = run({});
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.stdout).toContain("::error::inclusive-eval CLI not found in RUNNER_TEMP");
  });
});

describe("run step: arguments", () => {
  beforeEach(withInstalledCli);

  it("runs with no flags when only the API key is set", () => {
    expect(cliArgs({})).toEqual([]);
  });

  it("passes every option in a fixed order", () => {
    expect(
      cliArgs({
        concurrency: "10",
        "red-team": "true",
        severity: "critical",
        category: "identity,privacy",
        domain: "healthcare",
        "system-prompt": "Be kind.",
      }),
    ).toEqual([
      "--system",
      "Be kind.",
      "--domain",
      "healthcare",
      "--category",
      "identity,privacy",
      "--severity",
      "critical",
      "--red-team",
      "--concurrency",
      "10",
    ]);
  });

  it("does not pass eval-version or fail-on to the CLI", () => {
    const r = runWithCli({ "eval-version": "3.2.0", "fail-on": "NEEDS_WORK" }, evalOutput("PASS"));
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => c.argv)).toEqual([[]]);
  });

  it.each([
    ["5", []],
    ["", []],
    ["1", ["--concurrency", "1"]],
    ["10", ["--concurrency", "10"]],
  ])("concurrency %j gives %j", (value, expected) => {
    expect(cliArgs({ concurrency: value })).toEqual(expected);
  });

  it.each(["true"])("adds --adversarial only for %j", (value) => {
    expect(cliArgs({ adversarial: value })).toEqual(["--adversarial"]);
  });

  it.each(["false", "", "TRUE", "True", "yes", "1", " true"])("does not add --adversarial for %j", (value) => {
    expect(cliArgs({ adversarial: value })).toEqual([]);
  });

  it.each(["false", "", "TRUE", "yes", "1"])("does not add --red-team for %j", (value) => {
    expect(cliArgs({ "red-team": value })).toEqual([]);
  });

  it("passes both mode flags through and leaves the CLI to reject the combination", () => {
    expect(cliArgs({ adversarial: "true", "red-team": "true" })).toEqual(["--adversarial", "--red-team"]);
  });

  it("keeps a multi-line system prompt as one argument", () => {
    const prompt = "Line one.\nLine two.\n";
    expect(cliArgs({ "system-prompt": prompt })).toEqual(["--system", prompt]);
  });

  it("passes values that start with a dash as data", () => {
    expect(cliArgs({ domain: "--model", category: "-v" })).toEqual(["--domain", "--model", "--category", "-v"]);
  });
});

describe("run step: fail-on values", () => {
  beforeEach(withInstalledCli);

  // A trailing newline is what a YAML block scalar (`fail-on: |`) passes.
  it.each(["FAIL", "fail", "Fail", "NEEDS_WORK", "needs_work", "Needs_Work", "", "NEEDS_WORK\n"])(
    "accepts %j",
    (value) => {
      const r = runWithCli({ "fail-on": value }, evalOutput("PASS"));
      expect(r.status).toBe(0);
      expect(r.calls).toHaveLength(1);
    },
  );

  it.each([
    ["a typo", "NEEDS-WORK"],
    ["another verdict", "PASS"],
    ["a red-team verdict", "PARTIAL"],
    ["a list", "FAIL,NEEDS_WORK"],
    ["a boolean", "true"],
    ["leading space", " FAIL"],
    ["trailing space", "NEEDS_WORK "],
    ["whitespace only", "   "],
  ])("rejects %s before running the CLI", (_label, value) => {
    const r = runWithCli({ "fail-on": value }, evalOutput("PASS"));
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.stdout).toContain("::error::fail-on must be FAIL or NEEDS_WORK.");
  });

  it("reports a bad fail-on before a missing CLI", () => {
    const fresh = makeSandbox();
    const env = resolveEnv(runEval.env, {
      inputs: withDefaults(doc.inputs, { "anthropic-api-key": KEY, "fail-on": "nope" }),
    });
    const r = runStep(fresh, runEval, env);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("fail-on must be FAIL or NEEDS_WORK");
    expect(r.stdout).not.toContain("CLI not found");
  });
});

describe("run step: verdicts and exit codes", () => {
  beforeEach(withInstalledCli);

  // [fail-on, verdict the CLI prints, step exit status]. In every row the
  // stub CLI exits with the real CLI's code for that verdict (CLI_EXIT).
  it.each([
    ["FAIL", "PASS", 0],
    ["FAIL", "NEEDS_WORK", 0],
    ["FAIL", "FAIL", 1],
    ["FAIL", "RESILIENT", 0],
    ["FAIL", "PARTIAL", 0],
    ["FAIL", "VULNERABLE", 1],
    ["NEEDS_WORK", "PASS", 0],
    ["NEEDS_WORK", "NEEDS_WORK", 1],
    ["NEEDS_WORK", "FAIL", 1],
    ["NEEDS_WORK", "RESILIENT", 0],
    ["NEEDS_WORK", "PARTIAL", 1],
    ["NEEDS_WORK", "VULNERABLE", 1],
  ] as const)("fail-on %s, verdict %s: exits %i", (failOn, verdict, status) => {
    const r = runWithCli({ "fail-on": failOn }, outputFor(verdict), CLI_EXIT[verdict]);
    expect(r.status).toBe(status);
    expect(r.calls).toHaveLength(1);
  });

  it.each(["NEEDS_WORK", "PARTIAL"] as const)("names the %s verdict when fail-on NEEDS_WORK fails the step", (verdict) => {
    const r = runWithCli({ "fail-on": "NEEDS_WORK" }, outputFor(verdict));
    expect(r.stdout).toContain(`::error::Verdict is ${verdict} and fail-on is NEEDS_WORK.`);
  });

  it("keeps the CLI's output in the log", () => {
    const output = evalOutput("NEEDS_WORK");
    for (const failOn of ["FAIL", "NEEDS_WORK"]) {
      expect(runWithCli({ "fail-on": failOn }, output).stdout).toContain(output);
    }
  });

  it.each([0, 1, 2, 42])("exits with the CLI's exit code (%i) with the default fail-on", (code) => {
    expect(runWithCli({}, "", code).status).toBe(code);
  });

  it.each([1, 2, 42])("keeps the CLI's non-zero exit code (%i) with fail-on NEEDS_WORK, whatever it printed", (code) => {
    const r = runWithCli({ "fail-on": "NEEDS_WORK" }, evalOutput("PASS"), code);
    expect(r.status).toBe(code);
    expect(r.stdout).not.toContain("::error::");
  });

  it("does not read the output with the default fail-on", () => {
    const r = runWithCli({}, "no verdict here\n");
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("::error::");
  });

  it("treats lower-case needs_work the same as NEEDS_WORK", () => {
    expect(runWithCli({ "fail-on": "needs_work" }, evalOutput("NEEDS_WORK")).status).toBe(1);
  });

  it("writes the captured output to RUNNER_TEMP, not the caller's workspace", () => {
    const r = runWithCli({ "fail-on": "NEEDS_WORK" }, evalOutput("PASS"));
    expect(r.created).toEqual([]);
    const files = readdirSync(sb.runnerTemp).filter((f) => f.startsWith("inclusive-eval-output."));
    expect(files).toHaveLength(1);
    expect(readFileSync(join(sb.runnerTemp, files[0]), "utf8")).toContain("Verdict: ✅ PASS");
  });
});

describe("run step: reading the verdict with fail-on NEEDS_WORK", () => {
  beforeEach(withInstalledCli);
  const needsWork = (output: string) => runWithCli({ "fail-on": "NEEDS_WORK" }, output);

  it.each([
    ["no output", ""],
    ["output with no verdict line", "Running 10 scenarios...\n10/10 scenarios passed\n"],
    ["JSON output", '{"verdict":"PASS"}\n'],
    ["an indented verdict line", "  Verdict: PASS\n"],
    ["a verdict line with no verdict", "Verdict:\n"],
    ["an unknown verdict", "Verdict: ✅ MAYBE\n"],
    ["a lower-case verdict", "Verdict: ✅ pass\n"],
    ["a verdict glued to other text", "Verdict: PASSED\n"],
  ])("fails closed on %s", (_label, output) => {
    const r = needsWork(output);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("::error::fail-on is NEEDS_WORK, but no verdict was found in the CLI output.");
  });

  it("reads the summary's verdict, not a later line", () => {
    expect(needsWork(`${evalOutput("NEEDS_WORK")}Verdict: ✅ PASS\n`).status).toBe(1);
    expect(needsWork(`${evalOutput("PASS")}Verdict: ⚠️ NEEDS_WORK\n`).status).toBe(0);
  });

  it("ignores a verdict mentioned inside a failure message", () => {
    const output = evalOutput("NEEDS_WORK").replace("Why high-1 failed", "Verdict: PASS");
    expect(output).toContain("  → Verdict: PASS");
    expect(needsWork(output).status).toBe(1);
  });

  it("handles CRLF line endings and a missing final newline", () => {
    expect(needsWork("Verdict: ⚠️ NEEDS_WORK\r\n").status).toBe(1);
    expect(needsWork("Verdict: ✅ PASS\r\n").status).toBe(0);
    expect(needsWork("Verdict: ✅ PASS").status).toBe(0);
    expect(needsWork("Verdict: RESILIENT").status).toBe(0);
  });

  it("never runs text from the output as a command", () => {
    const r = needsWork("Verdict: $(touch PWNED)\nVerdict: `touch PWNED2`\n");
    expect(r.status).toBe(1);
    expect(r.created).toEqual([]);
  });
});

describe("run step: injection", () => {
  beforeEach(withInstalledCli);

  const flagFor: Record<string, string> = {
    "system-prompt": "--system",
    domain: "--domain",
    category: "--category",
    severity: "--severity",
    concurrency: "--concurrency",
  };

  for (const [label, payload] of Object.entries(INJECTION_PAYLOADS)) {
    for (const [input, flag] of Object.entries(flagFor)) {
      it(`passes a ${label} payload in ${input} through as data`, () => {
        const r = run({ [input]: payload });
        expect(r.created).toEqual([]);
        expect(r.calls).toHaveLength(1);
        expect(r.calls[0].argv).toEqual([flag, payload]);
      });
    }

    for (const input of ["adversarial", "red-team"]) {
      it(`ignores a ${label} payload in ${input}`, () => {
        const r = run({ [input]: payload });
        expect(r.created).toEqual([]);
        expect(r.status).toBe(0);
        expect(r.calls[0].argv).toEqual([]);
      });
    }

    it(`rejects a ${label} payload in fail-on without running it`, () => {
      const r = run({ "fail-on": payload });
      expect(r.created).toEqual([]);
      expect(r.status).toBe(1);
      expect(r.calls).toEqual([]);
    });

    it(`rejects a ${label} payload in eval-version without running it`, () => {
      const r = runInstall({ "eval-version": payload });
      expect(r.created).toEqual([]);
      expect(r.status).toBe(1);
      expect(r.calls).toEqual([]);
    });
  }
});

describe("install and run together", () => {
  /** An npm stub that, like npm, puts the CLI under the --prefix it's given. */
  function withInstallingNpm() {
    const root = join(sb.work, "..");
    const template = join(root, "cli-template", "inclusive-eval");
    const recorder = join(root, "recorder", "npm");
    writeStub(sb, template, "inclusive-eval");
    writeStub(sb, recorder, "npm");
    const npm = [
      "#!/bin/bash",
      'prev=""',
      'for a in "$@"; do',
      '  if [ "$prev" = "--prefix" ]; then',
      '    mkdir -p "$a/node_modules/.bin"',
      `    cp '${template}' "$a/node_modules/.bin/inclusive-eval"`,
      "  fi",
      '  prev="$a"',
      "done",
      `exec '${recorder}' "$@"`,
      "",
    ].join("\n");
    writeFileSync(join(sb.bin, "npm"), npm, { mode: 0o755 });
  }

  it("runs the CLI the install step put in place", () => {
    withInstallingNpm();
    const installed = runInstall({ "eval-version": "3.2.0" });
    expect(installed.status).toBe(0);
    expect(existsSync(join(sb.runnerTemp, INSTALLED_CLI))).toBe(true);
    const r = run({ category: "identity" });
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => [c.prog, ...c.argv])).toEqual([["inclusive-eval", "--category", "identity"]]);
  });

  it("fails a NEEDS_WORK run with fail-on NEEDS_WORK and passes it with the default", () => {
    withInstallingNpm();
    expect(runInstall({}).status).toBe(0);
    expect(runWithCli({}, evalOutput("NEEDS_WORK")).status).toBe(0);
    expect(runWithCli({ "fail-on": "NEEDS_WORK" }, evalOutput("NEEDS_WORK")).status).toBe(1);
  });
});

describe("README example", () => {
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
  const block = [...readme.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => /\/action@/.test(b));
  const example = parseYaml(block ?? "");
  const job = Object.values(example?.jobs ?? {})[0] as { steps?: { uses?: string; with?: Record<string, unknown> }[] };
  const usage = job?.steps?.find((s) => s.uses?.includes("/action@"));

  it("exists", () => {
    expect(block).toBeDefined();
    expect(usage).toBeDefined();
  });

  it("points at this repository's action", () => {
    expect(usage?.uses).toMatch(/^MichaelVacirca\/inclusive-eval-lab\/action@.+$/);
  });

  it("only passes inputs the action declares, including every required one", () => {
    const passed = Object.keys(usage?.with ?? {});
    for (const key of passed) expect(Object.keys(doc.inputs)).toContain(key);
    for (const [name, decl] of Object.entries(doc.inputs as Record<string, { required?: boolean }>)) {
      if (decl.required) expect(passed).toContain(name);
    }
  });
});
