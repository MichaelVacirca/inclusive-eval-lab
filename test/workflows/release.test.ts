import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALIAS_DIR,
  ALIAS_NAME,
  ALIAS_TAG_PREFIX,
  type Manifest,
  REPOSITORY_URL,
  ROOT,
  type RunNpm,
  type RunResult,
  TAG_PREFIX,
  type Workspace,
  aliasProblems,
  bumped,
  caretFloor,
  distTag,
  isPublished,
  isVersion,
  main,
  publishAlias,
  publishAll,
  publishOrder,
  publishable,
  readAlias,
  readWorkspaces,
  releaseFromTag,
  releaseProblems,
  rootSdkRange,
  versionFromTag,
} from "../../scripts/release.mts";
import { INJECTION_PAYLOADS, REPO_ROOT } from "./harness";

const SCRIPT = join(REPO_ROOT, "scripts", "release.mts");
const V = "3.3.0";

function pkg(dir: string, name: string, deps: Record<string, string> = {}, extra: Manifest = {}): Workspace {
  return {
    dir,
    manifest: {
      name,
      version: V,
      files: ["dist"],
      repository: { type: "git", url: REPOSITORY_URL, directory: dir },
      dependencies: deps,
      ...extra,
    },
  };
}

const CORE = pkg("core/eval-engine", "@inclusive-ai/eval-core", { tslib: "^2.0.0" });
const IDENTITY = pkg("domains/identity", "@inclusive-ai/domain-identity", { "@inclusive-ai/eval-core": `^${V}` });
const CONTENT = pkg("domains/content", "@inclusive-ai/domain-content", { "@inclusive-ai/eval-core": `^${V}` });
const EVAL = pkg("packages/eval", "@inclusive-ai/eval", {
  "@inclusive-ai/domain-identity": `^${V}`,
  "@inclusive-ai/domain-content": `^${V}`,
  "@inclusive-ai/eval-core": `^${V}`,
});
const SET = [EVAL, IDENTITY, CORE, CONTENT];

const SDK = "^0.131.0";
const ALIAS_V = "1.0.3";
const ALIAS_DEPS = { "@anthropic-ai/sdk": SDK, "@inclusive-ai/eval": `^${V}` };
const ALIAS: Workspace = {
  dir: ALIAS_DIR,
  manifest: {
    name: ALIAS_NAME,
    version: ALIAS_V,
    bin: { [ALIAS_NAME]: "bin.js" },
    files: ["bin.js", "README.md"],
    dependencies: ALIAS_DEPS,
    license: "MIT",
    repository: { type: "git", url: REPOSITORY_URL, directory: ALIAS_DIR },
  },
};

const names = (ws: Workspace[]) => ws.map((w) => w.manifest.name);

/** Replace one workspace's manifest fields in SET. */
function withChange(target: Workspace, change: Manifest): Workspace[] {
  return SET.map((w) => (w === target ? { dir: w.dir, manifest: { ...w.manifest, ...change } } : w));
}

/** A fake npm for publishAll: `published` lists name@version already on the registry. */
function fakeNpm(published: string[] = [], publishStatus: (name: string) => number = () => 0) {
  const calls: { args: string[]; cwd: string; capture: boolean }[] = [];
  const run: RunNpm = (args, cwd, capture): RunResult => {
    calls.push({ args, cwd, capture });
    if (args[0] === "view") {
      const spec = args[1];
      return published.includes(spec)
        ? { status: 0, stdout: JSON.stringify(spec.slice(spec.lastIndexOf("@") + 1)) }
        : { status: 1, stdout: JSON.stringify({ error: { code: "E404", summary: "No match found" } }) };
    }
    const dir = cwd.slice(ROOT.length + 1);
    const name = String(SET.find((w) => w.dir === dir)?.manifest.name);
    return { status: publishStatus(name), stdout: "" };
  };
  return { run, calls };
}

const quiet = { log: () => {} };

describe("the repository's packages", () => {
  const workspaces = readWorkspaces();
  const lock = JSON.parse(readFileSync(join(REPO_ROOT, "package-lock.json"), "utf8"));

  it("are the eight workspaces, all published", () => {
    expect(workspaces.map((w) => w.dir)).toEqual([
      "core/eval-engine",
      "domains/content",
      "domains/education",
      "domains/employment",
      "domains/healthcare",
      "domains/identity",
      "packages/adversarial",
      "packages/eval",
    ]);
    expect(publishable(workspaces)).toHaveLength(8);
  });

  it("are ready to release (what CI checks)", () => {
    expect(releaseProblems(workspaces)).toEqual([]);
  });

  it("match their package-lock.json records, so npm ci accepts the lockfile", () => {
    for (const w of workspaces) {
      const record = lock.packages[w.dir];
      expect(record?.version, w.dir).toBe(w.manifest.version);
      expect(record?.dependencies ?? {}, w.dir).toEqual(w.manifest.dependencies ?? {});
    }
  });

  it("publish dependencies first: eval-core first, eval last", () => {
    const order = publishOrder(workspaces).map((w) => w.manifest.name);
    expect(order[0]).toBe("@inclusive-ai/eval-core");
    expect(order.at(-1)).toBe("@inclusive-ai/eval");
    expect(new Set(order).size).toBe(8);
    for (const w of workspaces) {
      for (const dep of Object.keys((w.manifest.dependencies as Record<string, string>) ?? {})) {
        if (dep.startsWith("@inclusive-ai/")) expect(order.indexOf(dep), `${dep} before ${w.manifest.name}`).toBeLessThan(order.indexOf(w.manifest.name as string));
      }
    }
  });

  it("each ship the MIT license text, since npm packs LICENSE whatever files says", () => {
    const license = readFileSync(join(REPO_ROOT, "LICENSE"), "utf8");
    expect(license).toMatch(/^MIT License/);
    for (const w of publishable(workspaces)) {
      expect(w.manifest.license, w.dir).toBe("MIT");
      expect(readFileSync(join(REPO_ROOT, w.dir, "LICENSE"), "utf8"), `${w.dir}/LICENSE`).toBe(license);
    }
  });

  it("leave the alias out of the workspaces and the lockfile", () => {
    expect(workspaces.map((w) => w.dir)).not.toContain(ALIAS_DIR);
    expect(Object.keys(lock.packages)).not.toContain(ALIAS_DIR);
  });

  it("include an alias that is ready to release (what CI checks)", () => {
    expect(aliasProblems(readAlias(), workspaces, rootSdkRange())).toEqual([]);
    expect(rootSdkRange()).toMatch(/^\^\d+\.\d+\.\d+$/);
  });

  it("include an alias that ships the MIT license text too", () => {
    expect(readAlias().manifest.license).toBe("MIT");
    expect(readFileSync(join(REPO_ROOT, ALIAS_DIR, "LICENSE"), "utf8")).toBe(readFileSync(join(REPO_ROOT, "LICENSE"), "utf8"));
  });

  it("point npm at this repository, the one the README sends people to", () => {
    expect(REPOSITORY_URL).toBe("git+https://github.com/MichaelVacirca/inclusive-eval-lab.git");
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
    expect(readme).toContain("MichaelVacirca/inclusive-eval-lab/");
  });
});

describe("versionFromTag", () => {
  it.each([
    ["eval-v3.3.0", "3.3.0"],
    ["eval-v0.0.0", "0.0.0"],
    ["eval-v10.20.30", "10.20.30"],
    ["eval-v3.3.0-beta.1", "3.3.0-beta.1"],
    ["eval-v3.3.0-rc.1.x-y", "3.3.0-rc.1.x-y"],
  ])("reads %s as %s", (tag, version) => {
    expect(versionFromTag(tag)).toBe(version);
  });

  it.each([
    "",
    "3.3.0",
    "v3.3.0",
    "eval-3.3.0",
    "EVAL-v3.3.0",
    "eval-v",
    "eval-v3",
    "eval-v3.3",
    "eval-v3.3.0.1",
    "eval-v03.3.0",
    "eval-v3.03.0",
    "eval-v3.3.0-",
    "eval-v3.3.0-01",
    "eval-v3.3.0+build.1",
    " eval-v3.3.0",
    "eval-v3.3.0 ",
    "eval-v3.3.0\n",
    "eval-vlatest",
    "eval-v^3.3.0",
    ...Object.values(INJECTION_PAYLOADS).map((p) => `eval-v${p}`),
  ])("rejects %j", (tag) => {
    expect(() => versionFromTag(tag)).toThrow(/tag/);
  });

  it("uses the prefix the publish workflow is triggered by", () => {
    expect(TAG_PREFIX).toBe("eval-v");
  });
});

describe("distTag and isVersion", () => {
  it("publishes stable versions as latest and prereleases as next", () => {
    expect(distTag("3.3.0")).toBe("latest");
    expect(distTag("3.4.0-beta.1")).toBe("next");
  });

  it("accepts only full versions", () => {
    expect(isVersion("3.3.0")).toBe(true);
    for (const v of ["", "3", "3.3", "v3.3.0", "3.3.0.0", "^3.3.0", "latest"]) expect(isVersion(v), v).toBe(false);
  });

  it("refuses versions npm would refuse: unsafe integers and more than 256 characters", () => {
    expect(isVersion("9007199254740991.0.0")).toBe(true);
    expect(isVersion("9007199254740992.0.0")).toBe(false);
    expect(isVersion("1.99999999999999999999.0")).toBe(false);
    expect(isVersion(`1.0.0-${"a".repeat(250)}`)).toBe(true);
    expect(isVersion(`1.0.0-${"a".repeat(251)}`)).toBe(false);
    expect(() => versionFromTag("eval-v99999999999999999999.0.0")).toThrow(/does not name a version/);
  });
});

describe("publishOrder", () => {
  it("puts every package after its dependencies, whatever the input order", () => {
    for (const input of [SET, [...SET].reverse(), [CORE, EVAL, CONTENT, IDENTITY]]) {
      expect(names(publishOrder(input))).toEqual([
        "@inclusive-ai/eval-core",
        "@inclusive-ai/domain-content",
        "@inclusive-ai/domain-identity",
        "@inclusive-ai/eval",
      ]);
    }
  });

  it("ignores external dependencies and a package depending on itself", () => {
    const self = pkg("core/self", "@inclusive-ai/self", { "@inclusive-ai/self": `^${V}`, react: "^19" });
    expect(names(publishOrder([self]))).toEqual(["@inclusive-ai/self"]);
  });

  it("returns nothing for no packages and leaves its input alone", () => {
    expect(publishOrder([])).toEqual([]);
    const input = [...SET];
    publishOrder(input);
    expect(input).toEqual(SET);
  });

  it("refuses a dependency cycle, naming the packages in it", () => {
    const a = pkg("x/a", "@inclusive-ai/a", { "@inclusive-ai/b": `^${V}` });
    const b = pkg("x/b", "@inclusive-ai/b", { "@inclusive-ai/a": `^${V}` });
    expect(() => publishOrder([CORE, a, b])).toThrow("dependency cycle between @inclusive-ai/a, @inclusive-ai/b");
  });
});

describe("releaseProblems", () => {
  it("accepts a consistent set, with or without the tag's version", () => {
    expect(releaseProblems(SET)).toEqual([]);
    expect(releaseProblems(SET, V)).toEqual([]);
  });

  it("refuses a tag for another version", () => {
    expect(releaseProblems(SET, "3.4.0")).toEqual(["the tag names 3.4.0, but the packages are at 3.3.0"]);
  });

  it("refuses packages at different or invalid versions", () => {
    expect(releaseProblems(withChange(CORE, { version: "3.2.0" })).join()).toMatch(/not all at one version/);
    const invalid = SET.map((w) => ({ dir: w.dir, manifest: { ...w.manifest, version: "3.3" } }));
    expect(releaseProblems(invalid).join()).toMatch(/"3.3" is not a valid version/);
  });

  it.each(["*", "^3.2.0", "3.3.0", "~3.3.0", ">=3.3.0", "workspace:*"])(
    "refuses an internal dependency range of %j",
    (range) => {
      const problems = releaseProblems(withChange(IDENTITY, { dependencies: { "@inclusive-ai/eval-core": range } }));
      expect(problems).toEqual([`domains/identity: dependency @inclusive-ai/eval-core is ${JSON.stringify(range)}, expected "^3.3.0"`]);
    },
  );

  it("leaves external dependency ranges alone", () => {
    expect(releaseProblems(withChange(CORE, { dependencies: { tslib: "*" } }))).toEqual([]);
  });

  it.each([
    ["missing", undefined],
    ["a string", "github:MichaelVacirca/inclusive-eval-lab"],
    ["another repository", { type: "git", url: "git+https://github.com/InclusiveCode/inclusive-ai.git", directory: "core/eval-engine" }],
    ["the wrong directory", { type: "git", url: REPOSITORY_URL, directory: "core" }],
    ["no directory", { type: "git", url: REPOSITORY_URL }],
    ["no type", { url: REPOSITORY_URL, directory: "core/eval-engine" }],
  ])("refuses a repository field that is %s (trusted publishing needs it)", (_label, repository) => {
    expect(releaseProblems(withChange(CORE, { repository })).join()).toMatch(/core\/eval-engine: repository must be/);
  });

  it.each([undefined, [], ["src"], "dist"])("refuses files %j without dist", (files) => {
    expect(releaseProblems(withChange(CORE, { files })).join()).toMatch(/files must include "dist"/);
  });

  it("refuses names outside the scope and names used twice", () => {
    expect(releaseProblems(withChange(CORE, { name: "eval-core" })).join()).toMatch(/not in the @inclusive-ai\/ scope/);
    expect(releaseProblems(withChange(CONTENT, { name: "@inclusive-ai/domain-identity" })).join()).toMatch(/used by another workspace/);
  });

  it("skips private workspaces, unless a published package depends on one", () => {
    const tooling = pkg("tools/x", "@inclusive-ai/tooling", {}, { private: true, version: "0.0.1", repository: undefined });
    expect(releaseProblems([...SET, tooling])).toEqual([]);
    const dependent = withChange(EVAL, { dependencies: { "@inclusive-ai/tooling": "^0.0.1" } });
    expect(releaseProblems([...dependent, tooling])).toEqual([
      "packages/eval: depends on @inclusive-ai/tooling, which is private and never published",
    ]);
  });

  it("refuses an empty or all-private workspace list", () => {
    expect(releaseProblems([])).toEqual(["no publishable workspaces"]);
    expect(releaseProblems([pkg("x/a", "@inclusive-ai/a", {}, { private: true })])).toEqual(["no publishable workspaces"]);
  });
});

describe("bumped", () => {
  it("moves every version and internal range, and the result is releasable", () => {
    const next = bumped(SET, "3.4.0");
    expect(next.map((w) => w.manifest.version)).toEqual(["3.4.0", "3.4.0", "3.4.0", "3.4.0"]);
    expect(next[0].manifest.dependencies).toEqual({
      "@inclusive-ai/domain-identity": "^3.4.0",
      "@inclusive-ai/domain-content": "^3.4.0",
      "@inclusive-ai/eval-core": "^3.4.0",
    });
    expect(releaseProblems(next, "3.4.0")).toEqual([]);
  });

  it("keeps external ranges, key order, private packages and its input untouched", () => {
    const tooling = pkg("tools/x", "@inclusive-ai/tooling", {}, { private: true, version: "0.0.1" });
    const next = bumped([...SET, tooling], "4.0.0-beta.1");
    expect(next.find((w) => w.dir === "core/eval-engine")?.manifest.dependencies).toEqual({ tslib: "^2.0.0" });
    expect(Object.keys(next[0].manifest)).toEqual(Object.keys(EVAL.manifest));
    expect(next.at(-1)).toBe(tooling);
    expect(EVAL.manifest.version).toBe(V);
  });

  it.each(["", "3.4", "v3.4.0", "^3.4.0", "latest", "3.4.0\n"])("refuses %j", (version) => {
    expect(() => bumped(SET, version)).toThrow(/not a version/);
  });
});

describe("isPublished", () => {
  const answer = (status: number, stdout: string): RunNpm => () => ({ status, stdout });

  it("asks npm for exactly that version, as JSON", () => {
    const { run, calls } = fakeNpm();
    isPublished(run, "@inclusive-ai/eval", V);
    expect(calls).toEqual([
      { args: ["view", "@inclusive-ai/eval@3.3.0", "version", "--json", "--loglevel=silent"], cwd: ROOT, capture: true },
    ]);
  });

  it("reads npm's answers: the version, or a 404", () => {
    expect(isPublished(answer(0, '"3.3.0"\n'), "@inclusive-ai/eval", V)).toBe(true);
    expect(isPublished(answer(1, '{"error":{"code":"E404","summary":"No match found for version 3.3.0"}}'), "@inclusive-ai/eval", V)).toBe(false);
  });

  it.each([
    ["a network error", 1, '{"error":{"code":"ECONNREFUSED","summary":"connect ECONNREFUSED"}}', /ECONNREFUSED/],
    ["an auth error", 1, '{"error":{"code":"E401","summary":"Unable to authenticate"}}', /Unable to authenticate/],
    ["a server error", 1, '{"error":{"code":"E500"}}', /E500/],
    ["no output", 0, "", /printed no JSON/],
    ["non-JSON output", 1, "npm error something", /printed no JSON/],
    ["another version", 0, '"3.2.0"', /failed/],
    ["a 404 shape with exit 0 and no code", 0, '{"error":{}}', /failed/],
  ])("throws on %s instead of guessing", (_label, status, stdout, message) => {
    expect(() => isPublished(answer(status, stdout), "@inclusive-ai/eval", V)).toThrow(message);
  });
});

describe("publishAll", () => {
  it("publishes every package, dependencies first, from its own directory", () => {
    const { run, calls } = fakeNpm();
    expect(publishAll(SET, "eval-v3.3.0", run, quiet)).toEqual([
      "@inclusive-ai/eval-core",
      "@inclusive-ai/domain-content",
      "@inclusive-ai/domain-identity",
      "@inclusive-ai/eval",
    ]);
    const publishes = calls.filter((c) => c.args[0] === "publish");
    expect(publishes.map((c) => c.cwd)).toEqual([
      join(ROOT, "core/eval-engine"),
      join(ROOT, "domains/content"),
      join(ROOT, "domains/identity"),
      join(ROOT, "packages/eval"),
    ]);
    for (const c of publishes) {
      expect(c.args).toEqual(["publish", "--access", "public"]);
      expect(c.capture).toBe(false);
    }
  });

  it("checks the registry before each publish", () => {
    const { run, calls } = fakeNpm();
    publishAll(SET, "eval-v3.3.0", run, quiet);
    expect(calls.map((c) => c.args[0])).toEqual(["view", "publish", "view", "publish", "view", "publish", "view", "publish"]);
  });

  it("skips versions that are already on npm, so a re-run picks up where it stopped", () => {
    const { run, calls } = fakeNpm(["@inclusive-ai/eval-core@3.3.0", "@inclusive-ai/domain-content@3.3.0"]);
    const lines: string[] = [];
    expect(publishAll(SET, "eval-v3.3.0", run, { log: (l) => lines.push(l) })).toEqual([
      "@inclusive-ai/domain-identity",
      "@inclusive-ai/eval",
    ]);
    expect(calls.filter((c) => c.args[0] === "publish")).toHaveLength(2);
    expect(lines).toContain("@inclusive-ai/eval-core@3.3.0 is already on npm, skipping");
  });

  it("does nothing when everything is already published", () => {
    const { run, calls } = fakeNpm(SET.map((w) => `${w.manifest.name}@${V}`));
    expect(publishAll(SET, "eval-v3.3.0", run, quiet)).toEqual([]);
    expect(calls.every((c) => c.args[0] === "view")).toBe(true);
  });

  it("publishes a prerelease under next", () => {
    const pre = bumped(SET, "3.4.0-beta.1");
    const { run, calls } = fakeNpm();
    publishAll(pre, "eval-v3.4.0-beta.1", run, quiet);
    const publishes = calls.filter((x) => x.args[0] === "publish");
    expect(publishes).toHaveLength(4);
    for (const c of publishes) expect(c.args).toEqual(["publish", "--access", "public", "--tag", "next"]);
  });

  it("passes no --tag for a stable version, so npm won't move latest back to a lower version", () => {
    const { run, calls } = fakeNpm();
    publishAll(SET, "eval-v3.3.0", run, quiet);
    const publishes = calls.filter((x) => x.args[0] === "publish");
    expect(publishes).toHaveLength(4);
    for (const c of publishes) expect(c.args.some((a) => a.startsWith("--tag"))).toBe(false);
  });

  it("passes --dry-run through and still goes through every package", () => {
    const { run, calls } = fakeNpm();
    expect(publishAll(SET, "eval-v3.3.0", run, { ...quiet, dryRun: true })).toHaveLength(4);
    const publishes = calls.filter((x) => x.args[0] === "publish");
    expect(publishes).toHaveLength(4);
    for (const c of publishes) expect(c.args).toEqual(["publish", "--access", "public", "--dry-run"]);
  });

  it("stops at the first failed publish and says what already went out", () => {
    const { run, calls } = fakeNpm([], (name) => (name === "@inclusive-ai/domain-identity" ? 1 : 0));
    expect(() => publishAll(SET, "eval-v3.3.0", run, quiet)).toThrow(
      "npm publish failed for @inclusive-ai/domain-identity@3.3.0 (exit 1); published before it: @inclusive-ai/eval-core, @inclusive-ai/domain-content",
    );
    expect(calls.filter((c) => c.args[0] === "publish")).toHaveLength(3);
  });

  it("names no earlier packages when the first publish fails", () => {
    const { run } = fakeNpm([], () => 1);
    expect(() => publishAll(SET, "eval-v3.3.0", run, quiet)).toThrow(/published before it: none/);
  });

  it("publishes nothing if it can't tell whether a version is already out", () => {
    const run: RunNpm = (args) =>
      args[0] === "view" ? { status: 1, stdout: '{"error":{"code":"ECONNRESET"}}' } : { status: 0, stdout: "" };
    const calls: string[][] = [];
    expect(() => publishAll(SET, "eval-v3.3.0", (a, c, cap) => (calls.push(a), run(a, c, cap)), quiet)).toThrow(/ECONNRESET/);
    expect(calls.filter((a) => a[0] === "publish")).toEqual([]);
  });

  it.each([
    ["a malformed tag", "v3.3.0", /does not start with eval-v/],
    ["a tag for another version", "eval-v3.4.0", /the tag names 3.4.0, but the packages are at 3.3.0/],
  ])("calls npm not at all for %s", (_label, tag, message) => {
    const { run, calls } = fakeNpm();
    expect(() => publishAll(SET, tag, run, quiet)).toThrow(message);
    expect(calls).toEqual([]);
  });

  it("refuses an inconsistent set before calling npm", () => {
    const { run, calls } = fakeNpm();
    expect(() => publishAll(withChange(IDENTITY, { dependencies: { "@inclusive-ai/eval-core": "*" } }), "eval-v3.3.0", run, quiet)).toThrow(
      /not releasing eval-v3.3.0:\n {2}domains\/identity: dependency/,
    );
    expect(calls).toEqual([]);
  });
});

describe("main, on a scratch repository", () => {
  function scratchRepo(): string {
    const root = mkdtempSync(join(tmpdir(), "release-test-"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "x", private: true, workspaces: ["core/*", "packages/eval"], devDependencies: { "@anthropic-ai/sdk": SDK } }),
    );
    for (const w of [CORE, EVAL]) {
      mkdirSync(join(root, w.dir), { recursive: true });
      const deps = w === EVAL ? { "@inclusive-ai/eval-core": `^${V}` } : w.manifest.dependencies;
      writeFileSync(join(root, w.dir, "package.json"), JSON.stringify({ ...w.manifest, dependencies: deps }));
    }
    mkdirSync(join(root, "core", "notes"));
    mkdirSync(join(root, ALIAS_DIR));
    writeFileSync(join(root, ALIAS_DIR, "package.json"), JSON.stringify(ALIAS.manifest));
    writeFileSync(join(root, ALIAS_DIR, "bin.js"), "");
    return root;
  }
  const silent = () => {
    const out: string[] = [];
    return { out, restore: captureConsole(out) };
  };

  it("reads only directories with a package.json from the workspace globs", () => {
    expect(readWorkspaces(scratchRepo()).map((w) => w.dir)).toEqual(["core/eval-engine", "packages/eval"]);
  });

  it("refuses workspace patterns it can't expand", () => {
    const root = scratchRepo();
    writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["core/**"] }));
    expect(() => readWorkspaces(root)).toThrow(/unsupported workspaces pattern/);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x" }));
    expect(() => readWorkspaces(root)).toThrow(/no workspaces list/);
  });

  it("bump rewrites every manifest as two-space JSON with a final newline", () => {
    const root = scratchRepo();
    const { restore } = silent();
    try {
      expect(main(["bump", "3.4.0"], fakeNpm().run, root)).toBe(0);
    } finally {
      restore();
    }
    const text = readFileSync(join(root, "packages/eval/package.json"), "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "version": "3.4.0",\n');
    expect(JSON.parse(text).dependencies).toEqual({ "@inclusive-ai/eval-core": "^3.4.0" });
    expect(releaseProblems(readWorkspaces(root), "3.4.0")).toEqual([]);
  });

  it("check without a tag also checks the alias", () => {
    const root = scratchRepo();
    writeFileSync(join(root, ALIAS_DIR, "package.json"), JSON.stringify({ ...ALIAS.manifest, dependencies: { ...ALIAS_DEPS, "@anthropic-ai/sdk": "^0.78.0" } }));
    const { out, restore } = silent();
    try {
      expect(main(["check"], fakeNpm().run, root)).toBe(1);
      expect(main(["check", `eval-v${V}`], fakeNpm().run, root)).toBe(0);
      expect(main(["check", `alias-v${ALIAS_V}`], fakeNpm().run, root)).toBe(1);
    } finally {
      restore();
    }
    expect(out).toContain('error: alias: @anthropic-ai/sdk is "^0.78.0", expected "^0.131.0" as in the root package.json');
    expect(out).toContain(`ok: 2 packages ready for eval-v${V}`);
  });

  it("says what is ready", () => {
    const root = scratchRepo();
    const { out, restore } = silent();
    try {
      main(["check"], fakeNpm().run, root);
      main(["check", `alias-v${ALIAS_V}`], fakeNpm().run, root);
      main(["check", "nope"], fakeNpm().run, root);
    } finally {
      restore();
    }
    expect(out).toEqual([
      "ok: 2 packages and the inclusive-eval alias ready",
      `ok: inclusive-eval ready for alias-v${ALIAS_V}`,
      'error: tag "nope" starts with neither eval-v (the @inclusive-ai/ packages) nor alias-v (the inclusive-eval alias)',
    ]);
  });

  it("publish with an alias tag publishes only the alias", () => {
    const root = scratchRepo();
    const npm = fakeNpm([`@inclusive-ai/eval@${V}`]);
    const { out, restore } = silent();
    try {
      expect(main(["publish", `alias-v${ALIAS_V}`], npm.run, root)).toBe(0);
    } finally {
      restore();
    }
    expect(npm.calls.filter((c) => c.args[0] === "publish").map((c) => c.cwd)).toEqual([join(root, ALIAS_DIR)]);
    expect(out.at(-1)).toBe("published: inclusive-eval");
  });

  it.each([
    [["check"], 0],
    [["check", "eval-v3.3.0"], 0],
    [["check", "eval-v3.4.0"], 1],
    [["check", `alias-v${ALIAS_V}`], 0],
    [["check", "alias-v9.9.9"], 1],
    [["check", "alias-v"], 1],
    [["check", "nope"], 1],
    [["publish", "alias-v9.9.9"], 1],
    [["publish", `alias-v${ALIAS_V}`], 1],
    [["bump", "3.4"], 1],
    [[], 2],
    [["release"], 2],
    [["check", "eval-v3.3.0", "extra"], 2],
    [["bump"], 2],
    [["publish"], 2],
    [["publish", "eval-v3.3.0", "--force"], 2],
  ])("main(%j) exits %i", (argv, code) => {
    const root = scratchRepo();
    const { restore } = silent();
    try {
      expect(main(argv as string[], fakeNpm().run, root)).toBe(code);
    } finally {
      restore();
    }
  });
});

function captureConsole(out: string[]): () => void {
  const { log, error } = console;
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void out.push(a.join(" "));
  return () => {
    console.log = log;
    console.error = error;
  };
}

describe("the release script as a process, with a fake npm on PATH", () => {
  const order = publishOrder(readWorkspaces()).map((w) => w.dir);
  const version = String(readWorkspaces()[0].manifest.version);

  function fakeNpmBin(): { dir: string; log: string } {
    const dir = mkdtempSync(join(tmpdir(), "fake-npm-"));
    const log = join(dir, "calls.log");
    // view: "already published" for names listed in FAKE_PUBLISHED, otherwise
    // npm's E404 JSON. publish: exits with FAKE_PUBLISH_EXIT (default 0).
    const script = [
      "#!/bin/bash",
      `printf '%s\\t%s\\n' "$PWD" "$*" >> '${log}'`,
      'if [ "$1" = view ]; then',
      '  name="${2%@*}"',
      '  if [[ " $FAKE_PUBLISHED " == *" $name "* ]]; then printf \'"%s"\\n\' "${2##*@}"; exit 0; fi',
      '  printf \'{"error":{"code":"E404","summary":"No match found"}}\\n\'; exit 1',
      "fi",
      'exit "${FAKE_PUBLISH_EXIT:-0}"',
      "",
    ].join("\n");
    writeFileSync(join(dir, "npm"), script);
    chmodSync(join(dir, "npm"), 0o755);
    return { dir, log };
  }

  function runScript(args: string[], env: Record<string, string> = {}) {
    const bin = fakeNpmBin();
    const res = spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: tmpdir(),
      encoding: "utf8",
      env: { PATH: `${bin.dir}:${process.env.PATH}`, ...env },
    });
    let lines: string[] = [];
    try {
      lines = readFileSync(bin.log, "utf8").trim().split("\n");
    } catch {
      // npm was never called
    }
    return { status: res.status, out: res.stdout + res.stderr, calls: lines.map((l) => l.split("\t")) };
  }

  it("checks the repository from any working directory", () => {
    const r = runScript(["check", `eval-v${version}`]);
    expect(r.out).toContain("ok: 8 packages ready");
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([]);
  });

  it("publishes all eight packages in dependency order, each from its directory", () => {
    const r = runScript(["publish", `eval-v${version}`]);
    expect(r.status).toBe(0);
    const publishes = r.calls.filter(([, args]) => args.startsWith("publish"));
    expect(publishes.map(([cwd]) => cwd)).toEqual(order.map((d) => join(REPO_ROOT, d)));
    expect(new Set(publishes.map(([, args]) => args))).toEqual(new Set(["publish --access public"]));
  });

  it("skips what's already on npm", () => {
    const r = runScript(["publish", `eval-v${version}`], { FAKE_PUBLISHED: "@inclusive-ai/eval-core @inclusive-ai/adversarial" });
    expect(r.status).toBe(0);
    expect(r.calls.filter(([, args]) => args.startsWith("publish"))).toHaveLength(6);
    expect(r.out).toContain(`@inclusive-ai/eval-core@${version} is already on npm, skipping`);
  });

  it("exits 1 and stops at the first failed publish", () => {
    const r = runScript(["publish", `eval-v${version}`], { FAKE_PUBLISH_EXIT: "1" });
    expect(r.status).toBe(1);
    expect(r.calls.filter(([, args]) => args.startsWith("publish"))).toHaveLength(1);
    expect(r.out).toMatch(/npm publish failed for @inclusive-ai\/eval-core/);
  });

  it("exits 1 without calling npm for a tag that doesn't match", () => {
    const r = runScript(["publish", "eval-v0.0.1"]);
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.out).toContain(`the tag names 0.0.1, but the packages are at ${version}`);
  });

  it("exits 2 with usage for a bad command line", () => {
    const r = runScript(["publish"]);
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/^usage: /m);
  });

  const alias = readAlias();
  const aliasVersion = String(alias.manifest.version);
  const floor = caretFloor((alias.manifest.dependencies as Record<string, string>)["@inclusive-ai/eval"]);

  it("checks the alias from any working directory", () => {
    const r = runScript(["check", `alias-v${aliasVersion}`]);
    expect(r.out).toContain(`ok: inclusive-eval ready for alias-v${aliasVersion}`);
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([]);
  });

  it("publishes only the alias, from alias/, once the CLI version it needs is on npm", () => {
    const r = runScript(["publish", `alias-v${aliasVersion}`], { FAKE_PUBLISHED: "@inclusive-ai/eval" });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([
      [REPO_ROOT, `view @inclusive-ai/eval@${floor} version --json --loglevel=silent`],
      [REPO_ROOT, `view inclusive-eval@${aliasVersion} version --json --loglevel=silent`],
      [join(REPO_ROOT, ALIAS_DIR), "publish --access public"],
    ]);
  });

  it("refuses to publish the alias before the CLI version it needs is on npm", () => {
    const r = runScript(["publish", `alias-v${aliasVersion}`]);
    expect(r.status).toBe(1);
    expect(r.calls.filter(([, args]) => args.startsWith("publish"))).toEqual([]);
    expect(r.out).toContain(`inclusive-eval@${aliasVersion} needs @inclusive-ai/eval@${floor}, which is not on npm`);
  });
});

describe("releaseFromTag", () => {
  it.each([
    ["eval-v3.4.0", { kind: "packages", version: "3.4.0" }],
    ["alias-v1.0.3", { kind: "alias", version: "1.0.3" }],
    ["alias-v1.1.0-beta.1", { kind: "alias", version: "1.1.0-beta.1" }],
  ])("reads %j", (tag, release) => {
    expect(releaseFromTag(tag)).toEqual(release);
  });

  it.each(["alias-v", "alias-v1.0", "alias-vv1.0.3", "alias-v1.0.3 ", "eval-v", "eval-v1"])("refuses %j, which has a prefix but no version", (tag) => {
    expect(() => releaseFromTag(tag)).toThrow(/does not name a version like (alias|eval)-v1\.2\.3/);
  });

  it.each(["nope", "v1.0.3", "alias-1.0.3", "Alias-v1.0.3", "", "inclusive-eval@1.0.3"])("refuses %j, naming both prefixes", (tag) => {
    expect(() => releaseFromTag(tag)).toThrow(/starts with neither eval-v .* nor alias-v /);
  });

  it("reads the alias prefix through versionFromTag too", () => {
    expect(versionFromTag("alias-v1.0.3", ALIAS_TAG_PREFIX)).toBe("1.0.3");
    expect(() => versionFromTag("alias-v1.0.3")).toThrow(/does not start with eval-v/);
    expect(() => versionFromTag("eval-v1.0.3", ALIAS_TAG_PREFIX)).toThrow(/does not start with alias-v/);
  });
});

describe("caretFloor", () => {
  it.each([
    ["^3.4.0", "3.4.0"],
    ["^0.131.0", "0.131.0"],
  ])("%j starts at %j", (range, floor) => {
    expect(caretFloor(range)).toBe(floor);
  });

  it.each(["3.4.0", "~3.4.0", ">=3.4.0", "*", "^3.4", "^3.4.0-beta.1", "^ 3.4.0", "^3.4.0 || ^4.0.0", "", undefined, 3])(
    "has none for %j",
    (range) => {
      expect(caretFloor(range)).toBeUndefined();
    },
  );
});

describe("aliasProblems", () => {
  const alias = (change: Manifest = {}): Workspace => ({ dir: ALIAS_DIR, manifest: { ...ALIAS.manifest, ...change } });
  const problems = (change: Manifest = {}, version?: string) => aliasProblems(alias(change), SET, SDK, ROOT, version);
  const withEval = (range: string) => ({ dependencies: { ...ALIAS_DEPS, "@inclusive-ai/eval": range } });

  it("accepts the alias, with or without the tag's version", () => {
    expect(problems()).toEqual([]);
    expect(problems({}, ALIAS_V)).toEqual([]);
  });

  it("refuses a tag for another version", () => {
    expect(problems({}, "1.0.4")).toEqual([`the tag names 1.0.4, but the alias is at ${ALIAS_V}`]);
  });

  it.each<[Manifest, RegExp]>([
    [{ name: "inclusive-evals" }, /^alias: name "inclusive-evals" is not "inclusive-eval"$/],
    [{ name: undefined }, /^alias: name undefined is not "inclusive-eval"$/],
    [{ private: true }, /^alias: is marked private$/],
    [{ scripts: { prepublishOnly: "node evil.js" } }, /^alias: has scripts, which npm would run when publishing$/],
    [{ scripts: {} }, /^alias: has scripts/],
    [{ version: "1.0" }, /^alias: version "1\.0" is not a valid version$/],
    [{ version: 103 }, /^alias: version 103 is not a valid version$/],
    [{ repository: { type: "git", url: "git+https://github.com/InclusiveCode/inclusive-ai.git", directory: ALIAS_DIR } }, /^alias: repository must be /],
    [{ repository: { type: "git", url: REPOSITORY_URL } }, /^alias: repository must be /],
    [{ repository: { type: "git", url: REPOSITORY_URL, directory: "packages/eval" } }, /^alias: repository must be /],
    [{ repository: REPOSITORY_URL }, /^alias: repository must be /],
    [{ bin: "bin.js" }, /^alias: bin must be \{"inclusive-eval":"bin\.js"\}, got "bin\.js"$/],
    [{ bin: { "inclusive-eval": "cli.js" } }, /^alias: bin must be /],
    [{ bin: { "inclusive-eval": "bin.js", "other": "bin.js" } }, /^alias: bin must be /],
    [{ bin: undefined }, /^alias: bin must be /],
    [{ files: ["README.md"] }, /^alias: files must include "bin\.js", got \["README\.md"\]$/],
    [{ files: undefined }, /^alias: files must include "bin\.js"/],
    [{ dependencies: { ...ALIAS_DEPS, openai: "^6.0.0" } }, /^alias: dependencies must be exactly @inclusive-ai\/eval and @anthropic-ai\/sdk/],
    [{ dependencies: { "@inclusive-ai/eval": `^${V}` } }, /^alias: dependencies must be exactly/],
    [{ dependencies: undefined }, /^alias: dependencies must be exactly/],
    [{ dependencies: { ...ALIAS_DEPS, "@anthropic-ai/sdk": "^0.78.0" } }, /^alias: @anthropic-ai\/sdk is "\^0\.78\.0", expected "\^0\.131\.0" as in the root package\.json$/],
    [{ dependencies: { ...ALIAS_DEPS, "@anthropic-ai/sdk": "0.131.0" } }, /^alias: @anthropic-ai\/sdk is "0\.131\.0", expected/],
  ])("refuses %j", (change, message) => {
    const found = problems(change);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(message);
  });

  it.each(["*", "3.3.0", "~3.3.0", ">=3.3.0", "^3.3", "^3.3.0-beta.1", "latest", "file:../packages/eval"])(
    "refuses the CLI range %j, which isn't a plain caret range",
    (range) => {
      expect(problems(withEval(range))).toEqual([
        `alias: @inclusive-ai/eval is ${JSON.stringify(range)}, expected a caret range like "^3.4.0"`,
      ]);
    },
  );

  it.each(["^3.3.1", "^3.4.0", "^4.0.0", "^2.0.0", "^2.9.9"])("refuses %j, a CLI version this repository's 3.3.0 doesn't satisfy", (range) => {
    expect(problems(withEval(range))).toEqual([`alias: @inclusive-ai/eval is "${range}", but this repository's @inclusive-ai/eval is ${V}`]);
  });

  it.each(["^3.0.0", "^3.2.9", `^${V}`])("accepts %j, which this repository's 3.3.0 satisfies", (range) => {
    expect(problems(withEval(range))).toEqual([]);
  });

  it("compares with the CLI workspace's version even when it is a prerelease", () => {
    const pre = SET.map((w) => (w === EVAL ? { dir: w.dir, manifest: { ...w.manifest, version: "3.4.0-beta.1" } } : w));
    expect(aliasProblems(alias(withEval("^3.4.0")), pre, SDK, ROOT)).toEqual([]);
    expect(aliasProblems(alias(withEval("^3.5.0")), pre, SDK, ROOT)).toHaveLength(1);
  });

  it("refuses when there is no root SDK range or no CLI workspace to compare with", () => {
    expect(aliasProblems(alias(), SET, undefined, ROOT)).toEqual(["root package.json has no @anthropic-ai/sdk devDependency to compare the alias with"]);
    expect(aliasProblems(alias(), [CORE], SDK, ROOT)).toEqual([
      `alias: can't compare @inclusive-ai/eval "^${V}" with the workspace version undefined`,
    ]);
  });

  it("refuses an alias whose bin.js is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "alias-test-"));
    expect(aliasProblems(alias(), SET, SDK, root)).toEqual(["alias: bin.js is missing"]);
  });

  it("reports every problem at once", () => {
    expect(problems({ name: "x", private: true, files: [], bin: {} }, "9.9.9")).toHaveLength(5);
  });
});

describe("publishAlias", () => {
  const evalOut = `@inclusive-ai/eval@${V}`;
  const tag = `alias-v${ALIAS_V}`;
  const publishCalls = (calls: { args: string[] }[]) => calls.filter((c) => c.args[0] === "publish");

  it("checks the CLI version it needs is on npm, then publishes from alias/", () => {
    const npm = fakeNpm([evalOut]);
    expect(publishAlias(ALIAS, SET, SDK, tag, npm.run, quiet)).toEqual([ALIAS_NAME]);
    expect(npm.calls).toEqual([
      { args: ["view", evalOut, "version", "--json", "--loglevel=silent"], cwd: ROOT, capture: true },
      { args: ["view", `inclusive-eval@${ALIAS_V}`, "version", "--json", "--loglevel=silent"], cwd: ROOT, capture: true },
      { args: ["publish", "--access", "public"], cwd: join(ROOT, ALIAS_DIR), capture: false },
    ]);
  });

  it("refuses, without publishing, while the CLI version it needs is not on npm", () => {
    const npm = fakeNpm([]);
    expect(() => publishAlias(ALIAS, SET, SDK, tag, npm.run, quiet)).toThrow(
      `inclusive-eval@${ALIAS_V} needs @inclusive-ai/eval@${V}, which is not on npm`,
    );
    expect(publishCalls(npm.calls)).toEqual([]);
  });

  it("skips a version that is already on npm", () => {
    const lines: string[] = [];
    const npm = fakeNpm([evalOut, `inclusive-eval@${ALIAS_V}`]);
    expect(publishAlias(ALIAS, SET, SDK, tag, npm.run, { log: (l) => lines.push(l) })).toEqual([]);
    expect(publishCalls(npm.calls)).toEqual([]);
    expect(lines).toEqual([`inclusive-eval@${ALIAS_V} is already on npm, skipping`]);
  });

  it("publishes a prerelease under next, and passes --dry-run through", () => {
    const pre = { dir: ALIAS_DIR, manifest: { ...ALIAS.manifest, version: "1.1.0-beta.1" } };
    const npm = fakeNpm([evalOut]);
    publishAlias(pre, SET, SDK, "alias-v1.1.0-beta.1", npm.run, { ...quiet, dryRun: true });
    expect(publishCalls(npm.calls).map((c) => c.args)).toEqual([["publish", "--access", "public", "--tag", "next", "--dry-run"]]);
  });

  it("throws when npm publish fails", () => {
    const npm = fakeNpm([evalOut], () => 1);
    expect(() => publishAlias(ALIAS, SET, SDK, tag, npm.run, quiet)).toThrow(`npm publish failed for inclusive-eval@${ALIAS_V} (exit 1)`);
  });

  it("publishes nothing if it can't tell whether the CLI version is out", () => {
    const run: RunNpm = (args) =>
      args[0] === "view" ? { status: 1, stdout: JSON.stringify({ error: { code: "E403", summary: "Forbidden" } }) } : { status: 0, stdout: "" };
    expect(() => publishAlias(ALIAS, SET, SDK, tag, run, quiet)).toThrow(/npm view @inclusive-ai\/eval@3\.3\.0 failed \(exit 1\): Forbidden/);
  });

  it.each([
    ["alias-v1.0.4", /the tag names 1\.0\.4, but the alias is at 1\.0\.3/],
    [`eval-v${ALIAS_V}`, /does not start with alias-v/],
    ["alias-vlatest", /does not name a version/],
  ])("refuses %j before calling npm", (badTag, message) => {
    const npm = fakeNpm([evalOut]);
    expect(() => publishAlias(ALIAS, SET, SDK, badTag, npm.run, quiet)).toThrow(message);
    expect(npm.calls).toEqual([]);
  });
});
