import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  INJECTION_PAYLOADS,
  REPO_ROOT,
  type Sandbox,
  type Step,
  allSteps,
  fileExists,
  loadYaml,
  makeSandbox,
  resolveEnv,
  runStep,
  stepNamed,
  workflowFiles,
  writeStub,
} from "./harness";
import { ALIAS_NAME, ALIAS_TAG_PREFIX, REPOSITORY_URL, TAG_PREFIX, publishable, readWorkspaces } from "../../scripts/release.mts";

const FILES = [...workflowFiles(), "action/action.yml"];
const docs = Object.fromEntries(FILES.map((f) => [f, loadYaml(f)]));

/** Every `${{ ... }}` expression in a string, without the braces. */
function expressions(text: string): string[] {
  return [...text.matchAll(/\$\{\{\s*(.*?)\s*\}\}/g)].map((m) => m[1]);
}

function jobsOf(doc: ReturnType<typeof loadYaml>): Record<string, { defaults?: { run?: { "working-directory"?: string } }; steps?: Step[] }> {
  return doc.jobs ?? {};
}

describe("the files under test", () => {
  it("include every workflow and the composite action", () => {
    expect(FILES).toEqual(
      expect.arrayContaining([
        ".github/workflows/ci.yml",
        ".github/workflows/lgbt-safety-eval.yml",
        ".github/workflows/publish-eval.yml",
        "action/action.yml",
      ]),
    );
  });

  it.each(FILES)("%s parses to a mapping with steps", (file) => {
    expect(allSteps(docs[file]).length).toBeGreaterThan(0);
  });
});

describe.each(FILES)("%s", (file) => {
  const doc = docs[file];
  const steps = allSteps(doc);

  it("has no ${{ }} expressions inside run scripts", () => {
    for (const s of steps) {
      if (s.run) expect(expressions(s.run), `step "${s.name ?? s.run.slice(0, 40)}"`).toEqual([]);
    }
  });

  it("only uses whole-value inputs/secrets expressions in step env", () => {
    for (const s of steps) {
      expect(() => resolveEnv(s.env, { inputs: {}, secrets: {} })).not.toThrow();
    }
  });

  it("only references inputs it declares", () => {
    const declared = new Set<string>();
    if (doc.inputs) for (const n of Object.keys(doc.inputs)) declared.add(n);
    const triggers = doc.on && typeof doc.on === "object" ? Object.values(doc.on) : [];
    const perTrigger = triggers
      .map((t) => (t && typeof t === "object" && "inputs" in t ? Object.keys((t as { inputs: object }).inputs) : null))
      .filter((x): x is string[] => x !== null);
    for (const names of perTrigger) for (const n of names) declared.add(n);

    const used = new Set<string>();
    for (const e of expressions(readFileSync(join(REPO_ROOT, file), "utf8"))) {
      for (const m of e.matchAll(/inputs\.([A-Za-z0-9_-]+)/g)) used.add(m[1]);
    }
    for (const name of used) {
      expect(declared.has(name), `inputs.${name}`).toBe(true);
      // Inputs must exist for every trigger that declares inputs, or one of them sees "".
      for (const names of perTrigger) expect(names, `inputs.${name}`).toContain(name);
    }
  });

  it("declares, for reusable workflows, every secret it reads", () => {
    const call = doc.on?.workflow_call;
    if (!call) return;
    const declared = Object.keys(call.secrets ?? {});
    for (const e of expressions(readFileSync(join(REPO_ROOT, file), "utf8"))) {
      for (const m of e.matchAll(/secrets\.([A-Za-z0-9_]+)/g)) {
        if (m[1] !== "GITHUB_TOKEN") expect(declared, `secrets.${m[1]}`).toContain(m[1]);
      }
    }
  });

  it("only uses working directories that exist", () => {
    const dirs: string[] = [];
    for (const j of Object.values(jobsOf(doc))) {
      const d = j.defaults?.run?.["working-directory"];
      if (d) dirs.push(d);
    }
    for (const s of steps) if (s["working-directory"]) dirs.push(s["working-directory"]);
    for (const d of dirs) {
      expect(fileExists(d) && statSync(join(REPO_ROOT, d)).isDirectory(), `working-directory ${d}`).toBe(true);
    }
  });

  it("only points the npm cache at lockfiles that exist", () => {
    for (const s of steps) {
      const p = s.with?.["cache-dependency-path"];
      if (typeof p === "string") expect(fileExists(p), `cache-dependency-path ${p}`).toBe(true);
      if (s.with?.cache === "npm" && p === undefined) expect(fileExists("package-lock.json")).toBe(true);
    }
  });

  it("uses checkout and setup-node v7 with Node 26", () => {
    for (const s of steps) {
      if (s.uses?.startsWith("actions/checkout@")) expect(s.uses).toBe("actions/checkout@v7");
      if (s.uses?.startsWith("actions/setup-node@")) {
        expect(s.uses).toBe("actions/setup-node@v7");
        expect(s.with?.["node-version"]).toBe(26);
      }
    }
  });

  it("never pipes input through eval", () => {
    for (const s of steps) if (s.run) expect(s.run).not.toMatch(/(^|[\s;&|(])eval\s/m);
  });
});

describe("publish-eval.yml", () => {
  const file = ".github/workflows/publish-eval.yml";
  const text = readFileSync(join(REPO_ROOT, file), "utf8");
  const doc = docs[file];
  const job = doc.jobs.publish;
  const steps: Step[] = job.steps;
  const setup = steps.find((s) => s.uses?.startsWith("actions/setup-node@"));

  it("only runs for tags with the release script's prefixes: the packages' and the alias's", () => {
    expect(doc.on).toEqual({ push: { tags: [`${TAG_PREFIX}*`, `${ALIAS_TAG_PREFIX}*`] } });
  });

  it("never runs two releases at once or cancels one halfway", () => {
    expect(doc.concurrency).toEqual({ group: "publish-npm", "cancel-in-progress": false });
  });

  it("is the only job, in the npm environment, with only the permissions trusted publishing needs", () => {
    expect(Object.keys(doc.jobs)).toEqual(["publish"]);
    expect(job.environment).toBe("npm");
    expect(job.permissions).toEqual({ contents: "read", "id-token": "write" });
  });

  it("uses no npm token or other secret anywhere", () => {
    expect(text).not.toMatch(/secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN|_authToken/);
  });

  it("checks out full history, without persisting credentials", () => {
    const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with).toEqual({ "fetch-depth": 0, "persist-credentials": false });
  });

  it("sets up Node without registry-url (no token placeholder in front of OIDC) and without a dependency cache", () => {
    expect(setup?.with).toEqual({ "node-version": 26, "package-manager-cache": false });
  });

  it("checks the tag is on main before installing anything", () => {
    const names = steps.map((s) => s.name ?? s.uses ?? s.run?.trim());
    expect(names.indexOf("Check the tag is on main")).toBeLessThan(names.indexOf("npm ci --ignore-scripts"));
    expect(names.indexOf("Check the tag is on main")).toBeGreaterThan(names.indexOf("actions/checkout@v7"));
  });

  it("installs without install scripts, checks the tag, builds, typechecks and tests everything, then publishes", () => {
    expect(steps.filter((s) => s.run && s.name === undefined).map((s) => s.run?.trim())).toEqual([
      "npm ci --ignore-scripts",
      'node scripts/release.mts check "$GITHUB_REF_NAME"',
      "npm run build",
      "npm run typecheck",
      "npm test",
      'node scripts/release.mts publish "$GITHUB_REF_NAME"',
    ]);
    for (const s of steps) {
      expect(s.env, s.run ?? s.uses).toBeUndefined();
      expect(s["working-directory"], s.run ?? s.uses).toBeUndefined();
    }
  });

  it("installs, builds, typechecks and tests only for package releases; every release checks out, checks the tag and publishes", () => {
    const onlyPackages = `startsWith(github.ref_name, '${TAG_PREFIX}')`;
    const conditions = Object.fromEntries(steps.map((s) => [s.name ?? s.uses ?? s.run?.trim(), s.if]));
    expect(conditions).toEqual({
      "actions/checkout@v7": undefined,
      "Check the tag is on main": undefined,
      "actions/setup-node@v7": undefined,
      "npm ci --ignore-scripts": onlyPackages,
      'node scripts/release.mts check "$GITHUB_REF_NAME"': undefined,
      "npm run build": onlyPackages,
      "npm run typecheck": onlyPackages,
      "npm test": onlyPackages,
      'node scripts/release.mts publish "$GITHUB_REF_NAME"': undefined,
    });
  });

  it("is named for what it publishes, not just the @inclusive-ai scope", () => {
    expect(doc.name).toBe("Publish npm packages");
    for (const w of readWorkspaces()) expect(String(w.manifest.name)).toMatch(/^@inclusive-ai\//);
  });
});

describe("scripts/release.mts", () => {
  const source = readFileSync(join(REPO_ROOT, "scripts/release.mts"), "utf8");
  const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm), ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)].map(
    (m) => m[1],
  );

  it("imports only Node built-ins, since alias releases run it without npm ci", () => {
    expect(specifiers.length).toBeGreaterThanOrEqual(4);
    for (const s of specifiers) expect(s, s).toMatch(/^node:/);
  });

  it("has no bare or side-effect imports the pattern above would miss", () => {
    expect(source).not.toMatch(/^\s*import\s+["']/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});

describe("publish-eval.yml: the tag-on-main check", () => {
  const step = stepNamed(allSteps(docs[".github/workflows/publish-eval.yml"]), "Check the tag is on main");
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  let sb: Sandbox;
  beforeEach(() => {
    sb = makeSandbox();
    writeStub(sb, join(sb.bin, "git"), "git");
  });
  const run = (gitExit: number, tag = "eval-v3.3.0") =>
    runStep(sb, step, { GITHUB_SHA: SHA, GITHUB_REF_NAME: tag }, { STUB_EXIT_GIT: String(gitExit) });

  it("asks git whether the tagged commit is an ancestor of origin/main", () => {
    const r = run(0);
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => [c.prog, ...c.argv])).toEqual([["git", "merge-base", "--is-ancestor", SHA, "origin/main"]]);
  });

  it.each([1, 128])("fails with an error naming the tag when git says no (exit %i)", (code) => {
    const r = run(code);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("::error::eval-v3.3.0 is not on main. Tag a commit that has been merged.");
  });

  it("checks alias tags the same way", () => {
    expect(run(0, "alias-v1.0.3").status).toBe(0);
    const r = run(1, "alias-v1.0.3");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("::error::alias-v1.0.3 is not on main. Tag a commit that has been merged.");
  });

  it("never runs the tag name as a command", () => {
    for (const payload of Object.values(INJECTION_PAYLOADS)) {
      for (const prefix of [TAG_PREFIX, ALIAS_TAG_PREFIX]) {
        const r = run(1, `${prefix}${payload}`);
        expect(r.created).toEqual([]);
        expect(r.status).toBe(1);
      }
    }
  });
});

describe("docs/releasing.md", () => {
  const guide = readFileSync(join(REPO_ROOT, "docs/releasing.md"), "utf8");

  it("lists every published package with its directory", () => {
    for (const w of publishable(readWorkspaces())) {
      expect(guide, String(w.manifest.name)).toContain(`| \`${String(w.manifest.name)}\` | \`${w.dir}\` |`);
    }
  });

  it("gives the trusted-publisher settings npm will check", () => {
    const repo = /github\.com\/([^/]+)\/([^/.]+)\.git$/.exec(REPOSITORY_URL);
    expect(guide).toContain(`**Organization or user:** \`${repo?.[1]}\``);
    expect(guide).toContain(`**Repository:** \`${repo?.[2]}\``);
    expect(guide).toContain("**Workflow filename:** `publish-eval.yml`");
    expect(guide).toContain(`**Environment name:** \`${docs[".github/workflows/publish-eval.yml"].jobs.publish.environment}\``);
    expect(guide).toContain("`npm publish`");
  });

  it("uses the tag prefixes the workflow is triggered by", () => {
    expect(guide).toContain(`git push origin ${TAG_PREFIX}`);
    expect(guide).toContain(`git push origin ${ALIAS_TAG_PREFIX}`);
  });

  it("names the run to approve as the workflow is named", () => {
    expect(guide).toContain(`Approve the **${docs[".github/workflows/publish-eval.yml"].name}** run`);
  });

  it("protects the environment and both kinds of release tag before the first release", () => {
    expect(guide).toContain("**Required reviewers:**");
    expect(guide).toContain("**Allow administrators to bypass configured protection rules**");
    expect(guide).toContain(`two rules of type **Tag**: pattern \`${TAG_PREFIX}*\` and pattern \`${ALIAS_TAG_PREFIX}*\``);
    expect(guide).toContain(`tag ruleset**, targeting tags matching \`${TAG_PREFIX}*\` and \`${ALIAS_TAG_PREFIX}*\``);
    expect(guide.indexOf("### 1. GitHub")).toBeLessThan(guide.indexOf("### 2. npm"));
  });

  it("covers the alias: its trusted publisher, its publishing access and how to release it", () => {
    expect(guide).toContain(`and for \`${ALIAS_NAME}\`, on npmjs.com`);
    expect(guide).toContain(
      `\nnpm trust github ${ALIAS_NAME} --file publish-eval.yml --repo MichaelVacirca/inclusive-eval-lab --env npm --allow-publish\n`,
    );
    expect(guide).toContain(`\`${ALIAS_NAME}\` included, set **Settings → Publishing access**`);
    expect(guide).toContain("## Releasing the inclusive-eval alias");
    const section = guide.slice(guide.indexOf("## Releasing the inclusive-eval alias"));
    expect(section.indexOf(`Before the first \`${ALIAS_TAG_PREFIX}*\` tag`)).toBeGreaterThan(-1);
    expect(section.indexOf(`Before the first \`${ALIAS_TAG_PREFIX}*\` tag`)).toBeLessThan(section.indexOf("To release it:"));
  });

  it("says a major bump moves the alias's CLI range too", () => {
    expect(guide).toContain("For a new major version, also move the alias's `@inclusive-ai/eval` range");
  });

  it("explains the npm settings people stop at: direct publish, dist-tag and no edits", () => {
    expect(guide).toContain("Leave **Allow npm dist-tag** unticked");
    expect(guide).toContain('"Cannot be changed later"');
    expect(guide).toContain("delete that connection and add a new one");
  });

  it("warns that new versions take a while to appear before a re-run", () => {
    expect(guide).toContain("Wait for all of them before installing the release or re-running the job");
  });

  it("gives an npm trust command that covers every package with the same settings", () => {
    const loop = /for pkg in ([^;]+); do\n\s+npm trust github "@inclusive-ai\/\$pkg" (.+)\ndone/.exec(guide);
    expect(loop).not.toBeNull();
    const short = publishable(readWorkspaces()).map((w) => String(w.manifest.name).replace("@inclusive-ai/", ""));
    expect(loop?.[1].split(" ").sort()).toEqual(short.sort());
    expect(loop?.[2]).toBe("--file publish-eval.yml --repo MichaelVacirca/inclusive-eval-lab --env npm --allow-publish");
  });

  it("retires token publishing once trusted publishing works", () => {
    expect(guide).toContain('"Require two-factor authentication and disallow bypass 2fa tokens (recommended)"');
    expect(guide).toContain("Delete the old `NPM_TOKEN` repository secret");
  });
});

describe("ci.yml", () => {
  const ci = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
  const root = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

  const workspaces: string[] = (root.workspaces as string[]).flatMap((glob) => {
    const base = glob.replace(/\/\*$/, "");
    return readdirSync(join(REPO_ROOT, base))
      .map((d) => `${base}/${d}`)
      .filter((d) => fileExists(`${d}/package.json`));
  });

  it("finds the workspaces", () => {
    expect(workspaces.length).toBeGreaterThanOrEqual(8);
  });

  it.each(["build", "test", "typecheck"])("runs %s for every workspace", (script) => {
    for (const w of workspaces) expect(ci, `npm run ${script} -w ${w}`).toContain(`npm run ${script} -w ${w}\n`);
  });

  it("checks the packages are ready to release on every change", () => {
    expect(ci).toContain("node scripts/release.mts check\n");
  });

  it("runs these workflow tests and their typecheck", () => {
    expect(ci).toContain("npm run test:workflows\n");
    expect(ci).toContain("npm run typecheck:workflows\n");
    expect(root.scripts["test:workflows"]).toBeDefined();
    expect(root.scripts["typecheck:workflows"]).toBeDefined();
  });
});
