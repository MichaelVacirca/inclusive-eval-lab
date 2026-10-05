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
} from "./harness";

const doc = loadYaml("action/action.yml");
const steps = allSteps(doc);
const install = stepNamed(steps, "Install @inclusive-ai/eval");
const runEval = stepNamed(steps, "Run LGBTQIA+ safety eval");
const KEY = "sk-test";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});

function run(inputs: Record<string, string>, extraEnv: Record<string, string> = {}) {
  const env = resolveEnv(runEval.env, {
    inputs: withDefaults(doc.inputs, { "anthropic-api-key": KEY, ...inputs }),
  });
  return runStep(sb, runEval, env, extraEnv);
}

/** argv of the single CLI call, after `npx --no-install inclusive-eval`. */
function cliArgs(inputs: Record<string, string>): string[] {
  const r = run(inputs);
  expect(r.status).toBe(0);
  expect(r.calls).toHaveLength(1);
  const [call] = r.calls;
  expect(call.prog).toBe("npx");
  expect(call.argv.slice(0, 2)).toEqual(["--no-install", "inclusive-eval"]);
  return call.argv.slice(2);
}

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

  it("documents the defaults the run step relies on", () => {
    expect(doc.inputs["fail-on"].default).toBe("FAIL");
    expect(doc.inputs.adversarial.default).toBe("false");
    expect(doc.inputs["red-team"].default).toBe("false");
    expect(doc.inputs.concurrency.default).toBe("5");
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
});

describe("install step", () => {
  it("installs the CLI and SDK without saving to the caller's package.json", () => {
    const r = runStep(sb, install, {});
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => [c.prog, ...c.argv])).toEqual([
      ["npm", "install", "--no-save", "@inclusive-ai/eval", "@anthropic-ai/sdk"],
    ]);
    expect(r.calls[0].apiKeySet).toBe(false);
  });

  it("fails the step when npm install fails", () => {
    expect(runStep(sb, install, {}, { STUB_EXIT_NPM: "1" }).status).not.toBe(0);
  });
});

describe("run step: arguments", () => {
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

  it("passes the API key to the CLI", () => {
    expect(run({}).calls[0].apiKeySet).toBe(true);
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

describe("run step: exit codes and fail-on", () => {
  it.each([0, 1, 2, 42])("exits with the CLI's exit code (%i)", (code) => {
    expect(run({}, { STUB_EXIT_NPX: String(code) }).status).toBe(code);
  });

  it("checks for NEEDS_WORK only after a passing run when fail-on is NEEDS_WORK", () => {
    const r = run({ "fail-on": "NEEDS_WORK" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Checking for NEEDS_WORK verdict...");
  });

  it("does not check for NEEDS_WORK with the default fail-on", () => {
    expect(run({}).stdout).not.toContain("NEEDS_WORK");
  });

  it("does not check for NEEDS_WORK after a failing run", () => {
    const r = run({ "fail-on": "NEEDS_WORK" }, { STUB_EXIT_NPX: "1" });
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("NEEDS_WORK");
  });
});

describe("run step: injection", () => {
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
        expect(r.calls[0].argv.slice(2)).toEqual([flag, payload]);
      });
    }

    for (const input of ["adversarial", "red-team", "fail-on"]) {
      it(`ignores a ${label} payload in ${input}`, () => {
        const r = run({ [input]: payload });
        expect(r.created).toEqual([]);
        expect(r.status).toBe(0);
        expect(r.calls[0].argv.slice(2)).toEqual([]);
      });
    }
  }
});
