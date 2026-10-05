import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Step, REPO_ROOT, allSteps, fileExists, loadYaml, resolveEnv, workflowFiles } from "./harness";

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
  const doc = docs[".github/workflows/publish-eval.yml"];
  const job = doc.jobs.publish;
  const steps: Step[] = job.steps;

  it("only runs for eval-v* tags", () => {
    expect(doc.on).toEqual({ push: { tags: ["eval-v*"] } });
  });

  it("gets only the permissions publishing with provenance needs", () => {
    expect(job.permissions).toEqual({ contents: "read", "id-token": "write" });
  });

  it("does not restore a dependency cache in a publishing job", () => {
    const setup = steps.find((s) => s.uses?.startsWith("actions/setup-node@"));
    expect(setup?.with?.cache).toBeUndefined();
    expect(setup?.with?.["cache-dependency-path"]).toBeUndefined();
    expect(setup?.with?.["registry-url"]).toBe("https://registry.npmjs.org");
  });

  it("installs from the root lockfile without install scripts, builds, typechecks, then publishes", () => {
    const runs = steps.filter((s) => s.run).map((s) => s.run?.trim());
    expect(runs).toEqual([
      "npm ci --ignore-scripts",
      "npm run build",
      "npm run typecheck -w packages/eval",
      "npm publish --provenance --access public",
    ]);
  });

  it("publishes from packages/eval with the npm token only in that step", () => {
    const publish = steps.find((s) => s.run?.startsWith("npm publish"));
    expect(publish?.["working-directory"]).toBe("packages/eval");
    expect(publish?.env).toEqual({ NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}" });
    for (const s of steps) if (s !== publish) expect(JSON.stringify(s.env ?? {})).not.toContain("NPM_TOKEN");
  });

  it("publishes the package the workflow is named for", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "packages/eval/package.json"), "utf8"));
    expect(pkg.name).toBe("@inclusive-ai/eval");
    expect(doc.name).toBe(`Publish ${pkg.name}`);
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

  it("runs these workflow tests and their typecheck", () => {
    expect(ci).toContain("npm run test:workflows\n");
    expect(ci).toContain("npm run typecheck:workflows\n");
    expect(root.scripts["test:workflows"]).toBeDefined();
    expect(root.scripts["typecheck:workflows"]).toBeDefined();
  });
});
