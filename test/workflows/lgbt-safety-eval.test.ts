import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  INJECTION_PAYLOADS,
  REPO_ROOT,
  type Sandbox,
  allSteps,
  evaluateIf,
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
const ROOT_PKG = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
const SDK = `@anthropic-ai/sdk@${ROOT_PKG.devDependencies["@anthropic-ai/sdk"]}`;
const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout@"));
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

  it("checks out code only for source runs, without keeping git credentials", () => {
    expect(checkout?.uses).toBe("actions/checkout@v7");
    expect(checkout?.if).toBe("inputs.eval-version == 'source'");
    expect(checkout?.with).toEqual({ "persist-credentials": false });
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
            SDK,
          ],
          cwd: sb.work,
          apiKeySet: false,
        },
      ]);
    },
  );

  it("pins the SDK to the same range as the repo root", () => {
    expect(SDK).toMatch(/^@anthropic-ai\/sdk@\^?\d/);
    expect(runInstall({ "eval-version": "3" }).calls[0].argv.at(-1)).toBe(SDK);
  });

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

describe("source runs ignore case, like the checkout step's if:", () => {
  it.each(["Source", "SOURCE"])("treats %s as a source run in both steps", (value) => {
    withSourceTree();
    const install = runInstall({ "eval-version": value });
    expect(install.status).toBe(0);
    expect(install.calls.map((c) => c.argv[0])).toEqual(["ci", "run"]);
    const run = runCli({ "eval-version": value });
    expect(run.calls.map((c) => [c.prog, c.argv[0]])).toEqual([["node", "packages/eval/dist/cli.js"]]);
  });

  it.each(["source", "Source", "SOURCE", "3", "latest", "sources", "", " source"])(
    "checks out exactly when the install step builds from source (%j)",
    (value) => {
      withSourceTree();
      const inputs = withDefaults(call, { "eval-version": value });
      const checksOut = evaluateIf(String(checkout?.if), inputs);
      const builds = runInstall({ "eval-version": value }).calls.some((c) => c.argv[0] === "ci");
      expect(builds).toBe(checksOut);
    },
  );
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

  it("runs the CLI the install step put in place, for a published version", () => {
    withInstallingNpm();
    const installed = runInstall({ "eval-version": "3.2.0" });
    expect(installed.status).toBe(0);
    expect(installed.calls.map((c) => [c.prog, ...c.argv])).toEqual([
      expect.arrayContaining(["npm", "install", "@inclusive-ai/eval@3.2.0"]),
    ]);
    const r = runCli({ "eval-version": "3.2.0", category: "identity" });
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => [c.prog, ...c.argv])).toEqual([["inclusive-eval", "--category", "identity"]]);
  });

  it("builds and runs from source with the manual-run defaults", () => {
    withSourceTree();
    const inputs = withDefaults(dispatch, { category: "identity" });
    expect(inputs["eval-version"]).toBe("source");
    expect(evaluateIf(String(checkout?.if), inputs)).toBe(true);
    const env = (step: typeof install) => resolveEnv(step.env, { inputs, secrets: SECRETS });
    const installed = runStep(sb, install, env(install));
    expect(installed.status).toBe(0);
    expect(installed.calls.map((c) => [c.prog, ...c.argv])).toEqual([
      ["npm", "ci", "--ignore-scripts"],
      ["npm", "run", "build"],
    ]);
    const r = runStep(sb, runEval, env(runEval));
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => [c.prog, ...c.argv])).toEqual([
      ["node", "packages/eval/dist/cli.js", "--category", "identity"],
    ]);
  });
});

describe("README example", () => {
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
  const block = [...readme.matchAll(/```yaml\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .find((b) => b.includes("lgbt-safety-eval.yml@"));
  const example = parseYaml(block ?? "");
  const usage = Object.values(example?.jobs ?? {})[0] as {
    uses: string;
    with?: Record<string, unknown>;
    secrets?: Record<string, unknown>;
  };

  it("exists", () => {
    expect(block).toBeDefined();
  });

  it("points at this repository's workflow file", () => {
    const m = /^([^/]+\/[^/]+)\/(.+)@(.+)$/.exec(usage.uses);
    expect(m?.[1]).toBe("MichaelVacirca/inclusive-eval-lab");
    expect(m?.[2]).toBe(FILE);
  });

  it("only passes inputs the workflow declares", () => {
    for (const key of Object.keys(usage.with ?? {})) expect(Object.keys(call)).toContain(key);
  });

  it("passes every required secret", () => {
    const required = Object.entries(doc.on.workflow_call.secrets as Record<string, { required?: boolean }>)
      .filter(([, d]) => d.required)
      .map(([n]) => n);
    for (const name of required) expect(Object.keys(usage.secrets ?? {})).toContain(name);
  });

  it("uses a version the install step accepts", () => {
    withRegistryCli();
    const version = String(usage.with?.["eval-version"] ?? call["eval-version"].default);
    expect(runInstall({ "eval-version": version }).status).toBe(0);
  });
});
