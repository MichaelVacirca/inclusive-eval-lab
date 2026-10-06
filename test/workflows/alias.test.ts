/**
 * The inclusive-eval alias in alias/: what it ships and what its bin.js does.
 * Its release rules (version, dependency ranges, repository) are tested in release.test.ts.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALIAS_DIR, readAlias } from "../../scripts/release.mts";
import { REPO_ROOT } from "./harness";

const DIR = join(REPO_ROOT, ALIAS_DIR);
const CLI_PACKAGE = JSON.parse(readFileSync(join(REPO_ROOT, "packages/eval/package.json"), "utf8"));

/** A project with the alias's bin.js and a stand-in @inclusive-ai/eval whose CLI prints its arguments. */
function projectWithFakeCli(): string {
  const root = mkdtempSync(join(tmpdir(), "alias-bin-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  copyFileSync(join(DIR, "bin.js"), join(root, "bin.js"));
  const pkg = join(root, "node_modules", "@inclusive-ai", "eval");
  mkdirSync(join(pkg, "dist"), { recursive: true });
  const { name, type, main, exports } = CLI_PACKAGE;
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name, type, main, exports }));
  writeFileSync(join(pkg, "dist", "index.js"), "export {};\n");
  writeFileSync(join(pkg, "dist", "index.cjs"), "module.exports = {};\n");
  writeFileSync(
    join(pkg, "dist", "cli.js"),
    "console.log(JSON.stringify(process.argv.slice(2)));\nprocess.exit(Number(process.env.FAKE_EXIT ?? 0));\n",
  );
  return root;
}

describe("the inclusive-eval alias", () => {
  it("packs only bin.js, its README, the license and package.json", () => {
    const res = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: DIR, encoding: "utf8" });
    expect(res.status, res.stderr).toBe(0);
    const [packed] = JSON.parse(res.stdout);
    expect(packed.name).toBe("inclusive-eval");
    expect(packed.version).toBe(readAlias().manifest.version);
    expect(packed.files.map((f: { path: string }) => f.path).sort()).toEqual(["LICENSE", "README.md", "bin.js", "package.json"]);
  });

  it("starts the CLI beside @inclusive-ai/eval's entry point, passing every argument and the exit code through", () => {
    const root = projectWithFakeCli();
    const args = ["--domain", "healthcare", "--output", "my results.json", "--judge-model=x", "$(touch pwned)", ""];
    const ok = spawnSync(process.execPath, [join(root, "bin.js"), ...args], { cwd: root, encoding: "utf8" });
    expect(ok.status, ok.stderr).toBe(0);
    expect(JSON.parse(ok.stdout)).toEqual(args);

    const failed = spawnSync(process.execPath, [join(root, "bin.js")], { cwd: root, encoding: "utf8", env: { ...process.env, FAKE_EXIT: "7" } });
    expect(failed.status).toBe(7);
  });

  it("relies on the CLI's bin sitting beside the file its package entry resolves to", () => {
    // bin.js resolves "@inclusive-ai/eval" (the require condition) and runs cli.js in that folder.
    expect(dirname(CLI_PACKAGE.exports["."].require)).toBe(dirname(`./${CLI_PACKAGE.bin["inclusive-eval"]}`));
    expect(CLI_PACKAGE.bin["inclusive-eval"]).toMatch(/\/cli\.js$/);
  });

  it("runs the CLI built from packages/eval", () => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.OPENAI_API_KEY;
    const res = spawnSync(process.execPath, [join(DIR, "bin.js"), "--severity", "critical"], { cwd: tmpdir(), encoding: "utf8", env });
    expect(res.stderr).toContain("Set ANTHROPIC_API_KEY or OPENAI_API_KEY");
    expect(res.status).toBe(1);
  });
});
