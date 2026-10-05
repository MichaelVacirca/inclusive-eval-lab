// Tests for the harness itself, so a broken harness can't make the
// workflow tests pass vacuously.

import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type Sandbox,
  SYSTEM_PATH,
  evaluateIf,
  hostProgram,
  makeSandbox,
  pathWithout,
  resolveEnv,
  runStep,
  shellArgs,
  withDefaults,
  writeSpy,
  writeStub,
} from "./harness";

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

describe("evaluateIf", () => {
  it("compares an input with a literal, ignoring case as GitHub does", () => {
    expect(evaluateIf("inputs.v == 'source'", { v: "source" })).toBe(true);
    expect(evaluateIf("inputs.v == 'source'", { v: "SOURCE" })).toBe(true);
    expect(evaluateIf("inputs.v == 'source'", { v: "3" })).toBe(false);
    expect(evaluateIf("inputs.v == 'source'", {})).toBe(false);
  });

  it.each(["inputs.v != 'x'", "github.ref == 'main'", "inputs.v == 'a' && inputs.w == 'b'", "success()"])(
    "refuses expressions it doesn't model: %s",
    (expr) => {
      expect(() => evaluateIf(expr, {})).toThrow(/unsupported if expression/);
    },
  );
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

  it("returns only the calls made by that run", () => {
    runStep(sb, { run: "npm first" }, {});
    const second = runStep(sb, { run: "node second" }, {});
    expect(second.calls.map((c) => [c.prog, ...c.argv])).toEqual([["node", "second"]]);
  });

  it("reports files the script creates in the working directory", () => {
    expect(runStep(sb, { run: "touch PWNED" }, {}).created).toEqual(["PWNED"]);
  });

  it("rejects a step without a run script", () => {
    expect(() => runStep(sb, { uses: "actions/checkout@v7" }, {})).toThrow(/has no run script/);
  });
});

describe("hostProgram", () => {
  it("finds a program in the PATH runStep uses", () => {
    const path = hostProgram("sha256sum");
    expect(SYSTEM_PATH.some((dir) => path === join(dir, "sha256sum"))).toBe(true);
  });

  it("refuses a program the host doesn't have", () => {
    expect(() => hostProgram("no-such-program-for-tests")).toThrow(/not found/);
  });
});

describe("writeSpy", () => {
  it("records the call and runs the real program with the same arguments", () => {
    writeSpy(sb, "basename");
    const r = runStep(sb, { run: "basename /a/b.txt .txt" }, {});
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("b\n");
    expect(r.calls).toEqual([{ prog: "basename", argv: ["/a/b.txt", ".txt"], cwd: sb.work, apiKeySet: false }]);
  });

  it("passes stdin through and the real program's exit status back", () => {
    writeSpy(sb, "grep");
    const found = runStep(sb, { run: "grep -c b <<< $'a\\nb'" }, {});
    expect(found.status).toBe(0);
    expect(found.stdout).toBe("1\n");
    const missing = runStep(sb, { run: "grep -q z <<< abc" }, {});
    expect(missing.status).toBe(1);
    expect(missing.calls.map((c) => c.prog)).toEqual(["grep"]);
  });

  it("fails without running the real program when STUB_EXIT_<PROG> is set", () => {
    writeSpy(sb, "touch");
    const r = runStep(sb, { run: "touch made" }, {}, { STUB_EXIT_TOUCH: "5" });
    expect(r.status).toBe(5);
    expect(r.created).toEqual([]);
    expect(r.calls.map((c) => [c.prog, ...c.argv])).toEqual([["touch", "made"]]);
  });

  it("can spy on the programs the recorder itself uses", () => {
    writeSpy(sb, "wc");
    writeSpy(sb, "find");
    const r = runStep(sb, { run: "wc -c <<< abc" }, {});
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("4");
    expect(r.calls.map((c) => [c.prog, ...c.argv])).toEqual([["wc", "-c"]]);
  });
});

describe("pathWithout", () => {
  it("hides the named host programs and keeps the rest", () => {
    const PATH = pathWithout(sb, ["tar"]);
    expect(runStep(sb, { run: "command -v tar" }, {}).status).toBe(0);
    expect(runStep(sb, { run: "command -v tar" }, {}, { PATH }).status).not.toBe(0);
    expect(runStep(sb, { run: "command -v sha256sum" }, {}, { PATH }).status).toBe(0);
  });

  it("keeps the sandbox's stubs first, even for a hidden name", () => {
    writeStub(sb, join(sb.bin, "tar"), "tar");
    const r = runStep(sb, { run: "tar -x\nnpm ci" }, {}, { PATH: pathWithout(sb, ["tar"]) });
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => [c.prog, ...c.argv])).toEqual([
      ["tar", "-x"],
      ["npm", "ci"],
    ]);
  });
});
