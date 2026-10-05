// Tests for the harness itself, so a broken harness can't make the
// workflow tests pass vacuously.

import { beforeEach, describe, expect, it } from "vitest";
import { type Sandbox, makeSandbox, resolveEnv, runStep, shellArgs, withDefaults } from "./harness";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});

describe("withDefaults", () => {
  const decls = { a: { default: "x" }, b: {}, c: { default: false } };

  it("fills declared defaults and empty strings for inputs that weren't passed", () => {
    expect(withDefaults(decls, {})).toEqual({ a: "x", b: "", c: "false" });
  });

  it("keeps an explicitly passed empty string instead of the default", () => {
    expect(withDefaults(decls, { a: "" }).a).toBe("");
  });

  it("rejects inputs that aren't declared", () => {
    expect(() => withDefaults(decls, { nope: "1" })).toThrow(/undeclared input "nope"/);
  });
});

describe("resolveEnv", () => {
  it("resolves whole-value inputs and secrets expressions", () => {
    expect(
      resolveEnv(
        { A: "${{ inputs.a-b }}", B: "${{secrets.KEY}}", C: "plain", D: "${{ inputs.missing }}" },
        { inputs: { "a-b": "1" }, secrets: { KEY: "k" } },
      ),
    ).toEqual({ A: "1", B: "k", C: "plain", D: "" });
  });

  it.each([
    "${{ github.event.pull_request.title }}",
    "prefix ${{ inputs.a }}",
    "${{ inputs.a }}${{ inputs.b }}",
    "${{ format('{0}', inputs.a) }}",
  ])("refuses expressions it doesn't model: %s", (expr) => {
    expect(() => resolveEnv({ X: expr }, { inputs: { a: "1", b: "2" } })).toThrow(/unsupported expression/);
  });
});

describe("shellArgs", () => {
  it("matches the runner's bash invocations", () => {
    expect(shellArgs({})).toEqual(["-e"]);
    expect(shellArgs({ shell: "bash" })).toEqual(["--noprofile", "--norc", "-eo", "pipefail"]);
  });

  it("refuses shells it doesn't model", () => {
    expect(() => shellArgs({ shell: "pwsh" })).toThrow(/unsupported shell/);
  });
});

describe("runStep and the stubs", () => {
  it("records argv exactly, including empty strings, spaces and newlines", () => {
    const r = runStep(sb, { run: 'npm "" "a b" "$V"' }, { V: "x\ny" });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([{ prog: "npm", argv: ["", "a b", "x\ny"], cwd: sb.work, apiKeySet: false }]);
  });

  it("records calls with no arguments", () => {
    expect(runStep(sb, { run: "node" }, {}).calls[0].argv).toEqual([]);
  });

  it("reports whether the API key reached the stub", () => {
    expect(runStep(sb, { run: "npx" }, { ANTHROPIC_API_KEY: "k" }).calls[0].apiKeySet).toBe(true);
  });

  it("uses STUB_EXIT_<PROG> as the stub's exit code", () => {
    expect(runStep(sb, { run: "npm" }, {}, { STUB_EXIT_NPM: "7" }).status).toBe(7);
  });

  it("stops at the first failing command under -e", () => {
    const r = runStep(sb, { run: "npm\nnode" }, {}, { STUB_EXIT_NPM: "3" });
    expect(r.status).toBe(3);
    expect(r.calls.map((c) => c.prog)).toEqual(["npm"]);
  });

  it("reports files the script creates in the working directory", () => {
    expect(runStep(sb, { run: "touch PWNED" }, {}).created).toEqual(["PWNED"]);
  });

  it("rejects a step without a run script", () => {
    expect(() => runStep(sb, { uses: "actions/checkout@v7" }, {})).toThrow(/has no run script/);
  });
});
