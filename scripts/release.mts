// Checks, bumps and publishes the @inclusive-ai workspace packages, and the
// inclusive-eval alias in alias/, which is released on its own.
//
//   node scripts/release.mts check [tag]            consistency checks; with a tag, only that release, and that the tag names its version
//   node scripts/release.mts bump <version>         set every package's version and internal dependency ranges
//   node scripts/release.mts publish <tag> [--dry-run]
//
// eval-v<version> tags release the eight packages, alias-v<version> tags the alias.
// .github/workflows/publish-eval.yml runs `check` and `publish` for both.
// docs/releasing.md describes the whole release.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const SCOPE = "@inclusive-ai/";
export const TAG_PREFIX = "eval-v";
export const ALIAS_TAG_PREFIX = "alias-v";
export const ALIAS_NAME = "inclusive-eval";
// Outside the workspaces, so npm ci, the builds and the eval-v* releases leave it alone.
export const ALIAS_DIR = "alias";
const EVAL_NAME = `${SCOPE}eval`;
const SDK_NAME = "@anthropic-ai/sdk";
// npm trusted publishing only accepts packages whose repository.url matches
// the GitHub repository that runs the publish workflow.
export const REPOSITORY_URL = "git+https://github.com/MichaelVacirca/inclusive-eval-lab.git";

// Semantic Versioning 2.0.0 without build metadata, which npm drops.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

export interface Manifest {
  name?: unknown;
  version?: unknown;
  private?: unknown;
  dependencies?: unknown;
  repository?: unknown;
  files?: unknown;
  [key: string]: unknown;
}

export interface Workspace {
  /** Path relative to the repo root, e.g. "packages/eval". */
  dir: string;
  manifest: Manifest;
}

export interface RunResult {
  status: number | null;
  stdout: string;
}

/** Runs npm with these arguments in `cwd`. Output is captured only when `capture` is set. */
export type RunNpm = (args: string[], cwd: string, capture: boolean) => RunResult;

/** A version npm accepts: semver syntax, safe-integer parts, at most 256 characters. */
export function isVersion(version: string): boolean {
  const m = SEMVER.exec(version);
  return m !== null && version.length <= 256 && m.slice(1, 4).every((part) => Number.isSafeInteger(Number(part)));
}

/** "eval-v3.3.0" -> "3.3.0". Throws for anything that isn't the prefix plus a version. */
export function versionFromTag(tag: string, prefix: string = TAG_PREFIX): string {
  if (!tag.startsWith(prefix)) throw new Error(`tag ${JSON.stringify(tag)} does not start with ${prefix}`);
  const version = tag.slice(prefix.length);
  if (!isVersion(version)) throw new Error(`tag ${JSON.stringify(tag)} does not name a version like ${prefix}1.2.3`);
  return version;
}

export interface Release {
  /** "packages": the eight @inclusive-ai packages. "alias": the inclusive-eval alias. */
  kind: "packages" | "alias";
  version: string;
}

/** What a tag releases. Throws for a tag with neither prefix, or without a valid version. */
export function releaseFromTag(tag: string): Release {
  if (tag.startsWith(ALIAS_TAG_PREFIX)) return { kind: "alias", version: versionFromTag(tag, ALIAS_TAG_PREFIX) };
  if (tag.startsWith(TAG_PREFIX)) return { kind: "packages", version: versionFromTag(tag) };
  throw new Error(
    `tag ${JSON.stringify(tag)} starts with neither ${TAG_PREFIX} (the ${SCOPE} packages) nor ${ALIAS_TAG_PREFIX} (the ${ALIAS_NAME} alias)`,
  );
}

/**
 * Prereleases go to "next" so they never become what `npm install` picks by
 * default. Stable versions get "latest" from npm itself (publishAll passes no
 * --tag for them), so npm still refuses to move "latest" back to a lower
 * version, for example a hotfix for an older line.
 */
export function distTag(version: string): string {
  return version.includes("-") ? "next" : "latest";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The root package.json workspaces, in path order. Only "dir/*" globs and plain paths are supported. */
export function readWorkspaces(root: string = ROOT): Workspace[] {
  const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Manifest;
  const globs = rootManifest.workspaces;
  if (!Array.isArray(globs) || !globs.every((g) => typeof g === "string")) {
    throw new Error("root package.json has no workspaces list");
  }
  const dirs: string[] = [];
  for (const glob of globs as string[]) {
    if (glob.endsWith("/*") && !glob.slice(0, -2).includes("*")) {
      const base = glob.slice(0, -2);
      for (const entry of readdirSync(join(root, base), { withFileTypes: true })) {
        if (entry.isDirectory() && existsSync(join(root, base, entry.name, "package.json"))) {
          dirs.push(`${base}/${entry.name}`);
        }
      }
    } else if (!glob.includes("*")) {
      dirs.push(glob);
    } else {
      throw new Error(`unsupported workspaces pattern ${JSON.stringify(glob)}`);
    }
  }
  return [...new Set(dirs)].sort().map((dir) => ({
    dir,
    manifest: JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as Manifest,
  }));
}

/** Workspaces that get published: everything not marked private. */
export function publishable(workspaces: Workspace[]): Workspace[] {
  return workspaces.filter((w) => w.manifest.private !== true);
}

function nameOf(w: Workspace): string {
  return String(w.manifest.name);
}

function dependenciesOf(w: Workspace): Record<string, unknown> {
  return isObject(w.manifest.dependencies) ? w.manifest.dependencies : {};
}

/** Every package before the packages that depend on it; ties in path order. Throws on a cycle. */
export function publishOrder(workspaces: Workspace[]): Workspace[] {
  const byName = new Map(workspaces.map((w) => [nameOf(w), w]));
  const remaining = new Map(
    workspaces.map((w) => [w, new Set(Object.keys(dependenciesOf(w)).filter((d) => byName.has(d) && d !== nameOf(w)))]),
  );
  const order: Workspace[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter(([, deps]) => deps.size === 0).map(([w]) => w);
    if (ready.length === 0) {
      throw new Error(`dependency cycle between ${[...remaining.keys()].map(nameOf).sort().join(", ")}`);
    }
    ready.sort((a, b) => a.dir.localeCompare(b.dir));
    for (const w of ready) {
      order.push(w);
      remaining.delete(w);
      for (const deps of remaining.values()) deps.delete(nameOf(w));
    }
  }
  return order;
}

/**
 * Everything that would make a release of these workspaces wrong. With
 * `version`, every package must also be at exactly that version.
 */
export function releaseProblems(workspaces: Workspace[], version?: string): string[] {
  const problems: string[] = [];
  const published = publishable(workspaces);
  const privateNames = new Set(workspaces.filter((w) => w.manifest.private === true).map(nameOf));
  if (published.length === 0) return ["no publishable workspaces"];

  const seen = new Set<string>();
  for (const w of published) {
    const name = w.manifest.name;
    if (typeof name !== "string" || !name.startsWith(SCOPE)) {
      problems.push(`${w.dir}: name ${JSON.stringify(name)} is not in the ${SCOPE} scope`);
    } else if (seen.has(name)) {
      problems.push(`${w.dir}: name ${name} is used by another workspace`);
    }
    seen.add(String(name));
  }

  const versions = [...new Set(published.map((w) => w.manifest.version))];
  const shared = versions.length === 1 && typeof versions[0] === "string" ? versions[0] : undefined;
  if (shared === undefined) {
    problems.push(`packages are not all at one version: ${published.map((w) => `${w.dir}@${String(w.manifest.version)}`).join(", ")}`);
  } else if (!isVersion(shared)) {
    problems.push(`version ${JSON.stringify(shared)} is not a valid version`);
  }
  if (version !== undefined && shared !== undefined && shared !== version) {
    problems.push(`the tag names ${version}, but the packages are at ${shared}`);
  }

  const names = new Set(published.map(nameOf));
  for (const w of published) {
    for (const [dep, range] of Object.entries(dependenciesOf(w))) {
      if (privateNames.has(dep)) {
        problems.push(`${w.dir}: depends on ${dep}, which is private and never published`);
      } else if (names.has(dep) && shared !== undefined && range !== `^${shared}`) {
        problems.push(`${w.dir}: dependency ${dep} is ${JSON.stringify(range)}, expected "^${shared}"`);
      }
    }

    const repo = w.manifest.repository;
    if (!isObject(repo) || repo.type !== "git" || repo.url !== REPOSITORY_URL || repo.directory !== w.dir) {
      problems.push(
        `${w.dir}: repository must be {"type":"git","url":"${REPOSITORY_URL}","directory":"${w.dir}"}, got ${JSON.stringify(repo)}`,
      );
    }

    const files = w.manifest.files;
    if (!Array.isArray(files) || !files.includes("dist")) {
      problems.push(`${w.dir}: files must include "dist", got ${JSON.stringify(files)}`);
    }
  }
  return problems;
}

/** The alias package in alias/. */
export function readAlias(root: string = ROOT): Workspace {
  return { dir: ALIAS_DIR, manifest: JSON.parse(readFileSync(join(root, ALIAS_DIR, "package.json"), "utf8")) as Manifest };
}

/** The root package.json's range for the SDK, which the CLI is built and tested against. */
export function rootSdkRange(root: string = ROOT): unknown {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Manifest;
  return isObject(manifest.devDependencies) ? manifest.devDependencies[SDK_NAME] : undefined;
}

/** "^3.3.0" -> "3.3.0". undefined for any other kind of range. */
export function caretFloor(range: unknown): string | undefined {
  if (typeof range !== "string" || !range.startsWith("^")) return undefined;
  const version = range.slice(1);
  return isVersion(version) && !version.includes("-") ? version : undefined;
}

/** a <= b, comparing major.minor.patch only: a is a plain x.y.z, and a prerelease suffix on b is ignored. */
function atMost(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i];
  return true;
}

/**
 * Everything that would make a release of the alias wrong. It must point npm
 * at this repository, start the CLI through bin.js and nothing else, have no
 * scripts, depend only on the CLI and the SDK, take the SDK range the root
 * tests the CLI with, and ask for a CLI version this repository has reached
 * (ignoring a prerelease suffix here, e.g. a beta of the next major), in the
 * same major.
 * With `version`, the alias must be at exactly that version.
 */
export function aliasProblems(
  alias: Workspace,
  workspaces: Workspace[],
  sdkRange: unknown,
  root: string = ROOT,
  version?: string,
): string[] {
  const problems: string[] = [];
  const m = alias.manifest;
  const at = alias.dir;
  if (m.name !== ALIAS_NAME) problems.push(`${at}: name ${JSON.stringify(m.name)} is not ${JSON.stringify(ALIAS_NAME)}`);
  if (m.private === true) problems.push(`${at}: is marked private`);
  // npm publish runs lifecycle scripts, and an alias release installs nothing to check them against.
  if (m.scripts !== undefined) problems.push(`${at}: has scripts, which npm would run when publishing`);
  if (typeof m.version !== "string" || !isVersion(m.version)) {
    problems.push(`${at}: version ${JSON.stringify(m.version)} is not a valid version`);
  } else if (version !== undefined && m.version !== version) {
    problems.push(`the tag names ${version}, but the alias is at ${m.version}`);
  }

  const repo = m.repository;
  if (!isObject(repo) || repo.type !== "git" || repo.url !== REPOSITORY_URL || repo.directory !== at) {
    problems.push(`${at}: repository must be {"type":"git","url":"${REPOSITORY_URL}","directory":"${at}"}, got ${JSON.stringify(repo)}`);
  }

  const bin = m.bin;
  if (!isObject(bin) || Object.keys(bin).length !== 1 || bin[ALIAS_NAME] !== "bin.js") {
    problems.push(`${at}: bin must be {"${ALIAS_NAME}":"bin.js"}, got ${JSON.stringify(bin)}`);
  }
  if (!existsSync(join(root, at, "bin.js"))) problems.push(`${at}: bin.js is missing`);
  if (!Array.isArray(m.files) || !m.files.includes("bin.js")) {
    problems.push(`${at}: files must include "bin.js", got ${JSON.stringify(m.files)}`);
  }

  const deps = isObject(m.dependencies) ? m.dependencies : {};
  const names = Object.keys(deps).sort();
  if (names.join(",") !== [SDK_NAME, EVAL_NAME].sort().join(",")) {
    problems.push(`${at}: dependencies must be exactly ${EVAL_NAME} and ${SDK_NAME}, got ${JSON.stringify(names)}`);
  }
  if (typeof sdkRange !== "string") {
    problems.push(`root package.json has no ${SDK_NAME} devDependency to compare the alias with`);
  } else if (SDK_NAME in deps && deps[SDK_NAME] !== sdkRange) {
    problems.push(`${at}: ${SDK_NAME} is ${JSON.stringify(deps[SDK_NAME])}, expected ${JSON.stringify(sdkRange)} as in the root package.json`);
  }
  if (EVAL_NAME in deps) {
    const floor = caretFloor(deps[EVAL_NAME]);
    const cli = workspaces.find((w) => w.manifest.name === EVAL_NAME)?.manifest.version;
    if (floor === undefined) {
      problems.push(`${at}: ${EVAL_NAME} is ${JSON.stringify(deps[EVAL_NAME])}, expected a caret range like "^3.4.0"`);
    } else if (typeof cli !== "string" || !isVersion(cli)) {
      problems.push(`${at}: can't compare ${EVAL_NAME} ${JSON.stringify(deps[EVAL_NAME])} with the workspace version ${JSON.stringify(cli)}`);
    } else if (floor.split(".")[0] !== cli.split(".")[0] || !atMost(floor, cli)) {
      problems.push(`${at}: ${EVAL_NAME} is "^${floor}", but this repository's ${EVAL_NAME} is ${cli}`);
    }
  }
  return problems;
}

/** The manifests with `version` set and internal dependency ranges moved to "^version". Doesn't touch disk. */
export function bumped(workspaces: Workspace[], version: string): Workspace[] {
  if (!isVersion(version)) throw new Error(`${JSON.stringify(version)} is not a version like 1.2.3`);
  const names = new Set(publishable(workspaces).map(nameOf));
  return workspaces.map((w) => {
    if (w.manifest.private === true) return w;
    const manifest: Manifest = { ...w.manifest, version };
    if (isObject(w.manifest.dependencies)) {
      manifest.dependencies = Object.fromEntries(
        Object.entries(w.manifest.dependencies).map(([dep, range]) => [dep, names.has(dep) ? `^${version}` : range]),
      );
    }
    return { dir: w.dir, manifest };
  });
}

/** Whether name@version is on the registry. Throws on anything but a clear yes or a 404. */
export function isPublished(run: RunNpm, name: string, version: string, cwd: string = ROOT): boolean {
  // --loglevel=silent keeps npm's "npm error 404" lines for a not-yet-published
  // version out of the log; the JSON answer still goes to stdout.
  const res = run(["view", `${name}@${version}`, "version", "--json", "--loglevel=silent"], cwd, true);
  let out: unknown;
  try {
    out = JSON.parse(res.stdout);
  } catch {
    throw new Error(`npm view ${name}@${version} printed no JSON (exit ${res.status})`);
  }
  if (res.status === 0 && out === version) return true;
  if (isObject(out) && isObject(out.error) && out.error.code === "E404") return false;
  const summary = isObject(out) && isObject(out.error) ? String(out.error.summary ?? out.error.code) : JSON.stringify(out);
  throw new Error(`npm view ${name}@${version} failed (exit ${res.status}): ${summary}`);
}

/** npm publish arguments: public, prereleases under next, and --dry-run if asked. */
function publishArgs(version: string, dryRun: boolean): string[] {
  const args = ["publish", "--access", "public"];
  if (distTag(version) !== "latest") args.push("--tag", distTag(version));
  if (dryRun) args.push("--dry-run");
  return args;
}

export interface PublishOptions {
  root?: string;
  dryRun?: boolean;
  log?: (line: string) => void;
}

/**
 * Publishes every publishable workspace for `tag`, dependencies first. A
 * version that is already on the registry is skipped, so a failed release
 * can simply be re-run. Returns the names it published.
 */
export function publishAll(workspaces: Workspace[], tag: string, run: RunNpm, options: PublishOptions = {}): string[] {
  const { root = ROOT, dryRun = false, log = console.log } = options;
  const version = versionFromTag(tag);
  const problems = releaseProblems(workspaces, version);
  if (problems.length > 0) throw new Error(`not releasing ${tag}:\n  ${problems.join("\n  ")}`);

  const done: string[] = [];
  for (const w of publishOrder(publishable(workspaces))) {
    const name = nameOf(w);
    if (isPublished(run, name, version, root)) {
      log(`${name}@${version} is already on npm, skipping`);
      continue;
    }
    const args = publishArgs(version, dryRun);
    log(`${dryRun ? "dry run: " : ""}npm ${args.join(" ")}  (${w.dir})`);
    const res = run(args, join(root, w.dir), false);
    if (res.status !== 0) {
      const sofar = done.length > 0 ? done.join(", ") : "none";
      throw new Error(`npm publish failed for ${name}@${version} (exit ${res.status}); published before it: ${sofar}`);
    }
    done.push(name);
  }
  return done;
}

/**
 * Publishes the alias for an alias-v* tag, unless that version is already on
 * the registry. The CLI version its range starts at must already be on npm,
 * so the alias never points at a release that hasn't gone out. Returns the
 * names it published.
 */
export function publishAlias(
  alias: Workspace,
  workspaces: Workspace[],
  sdkRange: unknown,
  tag: string,
  run: RunNpm,
  options: PublishOptions = {},
): string[] {
  const { root = ROOT, dryRun = false, log = console.log } = options;
  const version = versionFromTag(tag, ALIAS_TAG_PREFIX);
  const problems = aliasProblems(alias, workspaces, sdkRange, root, version);
  if (problems.length > 0) throw new Error(`not releasing ${tag}:\n  ${problems.join("\n  ")}`);

  const floor = caretFloor((alias.manifest.dependencies as Record<string, unknown>)[EVAL_NAME]) as string;
  if (!isPublished(run, EVAL_NAME, floor, root)) {
    throw new Error(`${ALIAS_NAME}@${version} needs ${EVAL_NAME}@${floor}, which is not on npm`);
  }
  if (isPublished(run, ALIAS_NAME, version, root)) {
    log(`${ALIAS_NAME}@${version} is already on npm, skipping`);
    return [];
  }
  const args = publishArgs(version, dryRun);
  log(`${dryRun ? "dry run: " : ""}npm ${args.join(" ")}  (${alias.dir})`);
  const res = run(args, join(root, alias.dir), false);
  if (res.status !== 0) throw new Error(`npm publish failed for ${ALIAS_NAME}@${version} (exit ${res.status})`);
  return [ALIAS_NAME];
}

const runNpm: RunNpm = (args, cwd, capture) => {
  const res = spawnSync("npm", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
  });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout ?? "" };
};

const USAGE = "usage: node scripts/release.mts check [tag] | bump <version> | publish <tag> [--dry-run]";

/** Runs a command and returns the process exit code: 0 ok, 1 failed, 2 usage error. */
export function main(argv: string[], run: RunNpm = runNpm, root: string = ROOT): number {
  const [command, arg, ...rest] = argv;
  try {
    const workspaces = readWorkspaces(root);
    const aliasCheck = (version?: string) => aliasProblems(readAlias(root), workspaces, rootSdkRange(root), root, version);
    if (command === "check" && rest.length === 0) {
      const release = arg === undefined ? undefined : releaseFromTag(arg);
      const problems =
        release === undefined
          ? [...releaseProblems(workspaces), ...aliasCheck()]
          : release.kind === "alias"
            ? aliasCheck(release.version)
            : releaseProblems(workspaces, release.version);
      for (const p of problems) console.error(`error: ${p}`);
      if (problems.length === 0) {
        const packages = `${publishable(workspaces).length} packages`;
        const what = release === undefined ? `${packages} and the ${ALIAS_NAME} alias` : release.kind === "alias" ? ALIAS_NAME : packages;
        console.log(`ok: ${what} ready${arg ? ` for ${arg}` : ""}`);
      }
      return problems.length === 0 ? 0 : 1;
    }
    if (command === "bump" && arg !== undefined && rest.length === 0) {
      for (const w of bumped(workspaces, arg)) {
        writeFileSync(join(root, w.dir, "package.json"), `${JSON.stringify(w.manifest, null, 2)}\n`);
      }
      console.log(`bumped to ${arg}; now run: npm install --package-lock-only`);
      return 0;
    }
    if (command === "publish" && arg !== undefined && (rest.length === 0 || (rest.length === 1 && rest[0] === "--dry-run"))) {
      const dryRun = rest[0] === "--dry-run";
      const done =
        releaseFromTag(arg).kind === "alias"
          ? publishAlias(readAlias(root), workspaces, rootSdkRange(root), arg, run, { root, dryRun })
          : publishAll(workspaces, arg, run, { root, dryRun });
      console.log(`${dryRun ? "would publish" : "published"}: ${done.length > 0 ? done.join(", ") : "nothing new"}`);
      return 0;
    }
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    return 1;
  }
  console.error(USAGE);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
