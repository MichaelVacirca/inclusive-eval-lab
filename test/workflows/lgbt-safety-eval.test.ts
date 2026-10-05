import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  INJECTION_PAYLOADS,
  type Sandbox,
  allSteps,
  loadYaml,
  makeSandbox,
  resolveEnv,
  runStep,
  stepNamed,
  withDefaults,
  writeStub,
} from "./harness";

const FILE = ".github/workflows/lgbt-safety-eval.yml";
const doc = loadYaml(FILE);
const job = doc.jobs.eval;
const steps = allSteps(doc);
const install = stepNamed(steps, "Install the eval CLI");
const runEval = stepNamed(steps, "Run eval suite");
const dispatch = doc.on.workflow_dispatch.inputs;
const call = doc.on.workflow_call.inputs;

const REGISTRY_CLI = "inclusive-eval/node_modules/.bin/inclusive-eval";
const SECRETS = { ANTHROPIC_API_KEY: "sk-test" };

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});

/** Give the sandbox this repository's layout, for "source" runs. */
function withSourceTree() {
  mkdirSync(join(sb.work, "packages", "eval"), { recursive: true });
  writeFileSync(join(sb.work, "packages", "eval", "package.json"), '{"name":"@inclusive-ai/eval"}');
}

/** Put a stub CLI where the registry install would have put the real one. */
function withRegistryCli() {
  writeStub(sb, join(sb.runnerTemp, REGISTRY_CLI), "inclusive-eval");
}

function runInstall(inputs: Record<string, string>, extraEnv: Record<string, string> = {}) {
  const env = resolveEnv(install.env, { inputs: withDefaults(call, inputs), secrets: SECRETS });
  return runStep(sb, install, env, extraEnv);
}

function runCli(inputs: Record<string, string>, extraEnv: Record<string, string> = {}) {
  const env = resolveEnv(runEval.env, { inputs: withDefaults(call, inputs), secrets: SECRETS });
  return runStep(sb, runEval, env, extraEnv);
}

describe("triggers and inputs", () => {
  it("can be run by hand and called from other repositories", () => {
    expect(Object.keys(doc.on).sort()).toEqual(["workflow_call", "workflow_dispatch"]);
  });

  it("declares the same inputs for both triggers", () => {
    expect(Object.keys(dispatch).sort()).toEqual(Object.keys(call).sort());
    expect(Object.keys(call).sort()).toEqual(["category", "eval-version", "severity", "system-prompt"]);
  });

  it("keeps every input optional and typed as a string", () => {
    for (const decls of [dispatch, call]) {
      for (const decl of Object.values(decls) as { required?: boolean; type?: string }[]) {
        expect(decl.required).toBe(false);
        expect(decl.type).toBe("string");
      }
    }
  });

  it("defaults callers to a published major version and manual runs to this repo's source", () => {
    expect(call["eval-version"].default).toBe("3");
    expect(dispatch["eval-version"].default).toBe("source");
  });

  it("requires the API key secret from callers", () => {
    expect(doc.on.workflow_call.secrets).toEqual({ ANTHROPIC_API_KEY: { required: true } });
  });
});

describe("job setup", () => {
  it("only gets read access to repository contents", () => {
    expect(job.permissions).toEqual({ contents: "read" });
  });

  it("checks out code only for source runs", () => {
    const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout@"));
    expect(checkout?.uses).toBe("actions/checkout@v7");
    expect(checkout?.if).toBe("inputs.eval-version == 'source'");
  });

  it("sets up Node 26 without a dependency cache, since registry runs have no lockfile", () => {
    const setup = steps.find((s) => s.uses?.startsWith("actions/setup-node@"));
    expect(setup?.uses).toBe("actions/setup-node@v7");
    expect(setup?.with).toEqual({ "node-version": 26 });
  });

  it("installs before it runs", () => {
    expect(steps.indexOf(install)).toBeLessThan(steps.indexOf(runEval));
  });

  it("only exposes the API key to the step that runs the eval", () => {
    for (const s of steps) {
      const usesKey = JSON.stringify(s.env ?? {}).includes("secrets.ANTHROPIC_API_KEY");
      expect(usesKey).toBe(s === runEval);
    }
  });
});

describe("install step: published versions", () => {
  it.each(["3", "3.2.0", "^3.2.0", "~3.2", "3.x", "latest", "3.2.0-beta.1"])(
    "installs @inclusive-ai/eval@%s into RUNNER_TEMP without running install scripts",
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
            "@anthropic-ai/sdk",
          ],
          cwd: sb.work,
          apiKeySet: false,
        },
      ]);
    },
  );

  it("uses the caller default (3) when no version is passed", () => {
    const r = runInstall({});
    expect(r.status).toBe(0);
    expect(r.calls[0].argv).toContain("@inclusive-ai/eval@3");
  });

  it("fails the step when npm install fails", () => {
    const r = runInstall({ "eval-version": "3" }, { STUB_EXIT_NPM: "1" });
    expect(r.status).not.toBe(0);
  });
});

describe("install step: source", () => {
  it("installs and builds the workspace from the repo root", () => {
    withSourceTree();
    const r = runInstall({ "eval-version": "source" });
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => [c.prog, ...c.argv])).toEqual([
      ["npm", "ci", "--ignore-scripts"],
      ["npm", "run", "build"],
    ]);
    expect(r.calls.every((c) => c.cwd === sb.work && !c.apiKeySet)).toBe(true);
  });

  it("stops before building if npm ci fails", () => {
    withSourceTree();
    const r = runInstall({ "eval-version": "source" }, { STUB_EXIT_NPM: "1" });
    expect(r.status).not.toBe(0);
    expect(r.calls.map((c) => c.argv[0])).toEqual(["ci"]);
  });

  it("refuses source runs outside this repository, with a clear error", () => {
    const r = runInstall({ "eval-version": "source" });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.stdout + r.stderr).toMatch(/"source" only works in the repository that contains packages\/eval/);
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
    ["two versions", "3 4"],
    ["shell metacharacters", "3; touch PWNED"],
    ["command substitution", "$(touch PWNED)"],
  ])("rejects %s without calling npm", (_label, version) => {
    const r = runInstall({ "eval-version": version });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.created).toEqual([]);
    expect(r.stdout + r.stderr).toMatch(/eval-version/);
  });
});

describe("run step: which CLI runs", () => {
  it("runs the built CLI from packages/eval for source runs", () => {
    withSourceTree();
    const r = runCli({ "eval-version": "source" });
    expect(r.status).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].prog).toBe("node");
    expect(r.calls[0].argv).toEqual(["packages/eval/dist/cli.js"]);
  });

  it("runs the installed CLI from RUNNER_TEMP for published versions", () => {
    withRegistryCli();
    const r = runCli({ "eval-version": "3.2.0" });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([{ prog: "inclusive-eval", argv: [], cwd: sb.work, apiKeySet: true }]);
  });

  it("never falls back to npx, which could fetch a package from the registry", () => {
    withRegistryCli();
    const r = runCli({ "eval-version": "3" });
    expect(r.calls.map((c) => c.prog)).not.toContain("npx");
  });

  it("fails clearly if the installed CLI is missing", () => {
    const r = runCli({ "eval-version": "3" });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.stdout + r.stderr).toMatch(/inclusive-eval CLI not found/);
  });

  it("passes the API key to the CLI", () => {
    withRegistryCli();
    expect(runCli({}).calls[0].apiKeySet).toBe(true);
  });
});

describe("run step: arguments", () => {
  beforeEach(withRegistryCli);

  it("passes no flags when every filter is empty", () => {
    expect(runCli({ "system-prompt": "", category: "", severity: "" }).calls[0].argv).toEqual([]);
  });

  it("passes each set filter as its own flag, in a fixed order", () => {
    const r = runCli({ severity: "critical,high", category: "identity,moderation", "system-prompt": "Be kind." });
    expect(r.calls[0].argv).toEqual([
      "--system",
      "Be kind.",
      "--category",
      "identity,moderation",
      "--severity",
      "critical,high",
    ]);
  });

  it("keeps a multi-line system prompt as one argument", () => {
    const prompt = "You are a support agent.\nNever assume gender.\n";
    expect(runCli({ "system-prompt": prompt }).calls[0].argv).toEqual(["--system", prompt]);
  });

  it("keeps quotes, unicode and very long prompts intact", () => {
    const prompt = `“Use they/them” — don't 'guess'. ${"🏳️‍🌈".repeat(3)} ${"x".repeat(20000)}`;
    expect(runCli({ "system-prompt": prompt }).calls[0].argv).toEqual(["--system", prompt]);
  });

  it("passes a value that starts with a dash as data, not as a flag of the step", () => {
    expect(runCli({ category: "-v" }).calls[0].argv).toEqual(["--category", "-v"]);
  });

  it.each([0, 1, 2, 42])("exits with the CLI's exit code (%i)", (code) => {
    const r = runCli({ category: "identity" }, { STUB_EXIT_INCLUSIVE_EVAL: String(code) });
    expect(r.status).toBe(code);
  });
});

describe("run step: injection", () => {
  beforeEach(withRegistryCli);

  for (const [label, payload] of Object.entries(INJECTION_PAYLOADS)) {
    for (const input of ["system-prompt", "category", "severity"]) {
      it(`passes a ${label} payload in ${input} through as data`, () => {
        const flag = { "system-prompt": "--system", category: "--category", severity: "--severity" }[input];
        const r = runCli({ [input]: payload });
        expect(r.created).toEqual([]);
        expect(r.calls).toHaveLength(1);
        expect(r.calls[0].argv).toEqual([flag, payload]);
      });
    }
  }

  it("does not let a payload in eval-version run commands", () => {
    const r = runCli({ "eval-version": "$(touch PWNED)" });
    expect(r.created).toEqual([]);
  });
});
