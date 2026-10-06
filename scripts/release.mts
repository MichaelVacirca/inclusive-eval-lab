// Checks, bumps and publishes the @inclusive-ai workspace packages.
//
//   node scripts/release.mts check [tag]            consistency checks; with a tag, also that it names the version
//   node scripts/release.mts bump <version>         set every package's version and internal dependency ranges
//   node scripts/release.mts publish <tag> [--dry-run]
//
// .github/workflows/publish-eval.yml runs `check` and `publish` for eval-v* tags.
// docs/releasing.md describes the whole release.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const SCOPE = "@inclusive-ai/";
export const TAG_PREFIX = "eval-v";
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
export function versionFromTag(tag: string): string {
  if (!tag.startsWith(TAG_PREFIX)) throw new Error(`tag ${JSON.stringify(tag)} does not start with ${TAG_PREFIX}`);
  const version = tag.slice(TAG_PREFIX.length);
  if (!isVersion(version)) throw new Error(`tag ${JSON.stringify(tag)} does not name a version like ${TAG_PREFIX}1.2.3`);
  return version;
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
    const args = ["publish", "--access", "public"];
    if (distTag(version) !== "latest") args.push("--tag", distTag(version));
    if (dryRun) args.push("--dry-run");
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
    if (command === "check" && rest.length === 0) {
      const problems = releaseProblems(workspaces, arg === undefined ? undefined : versionFromTag(arg));
      for (const p of problems) console.error(`error: ${p}`);
      if (problems.length === 0) console.log(`ok: ${publishable(workspaces).length} packages ready${arg ? ` for ${arg}` : ""}`);
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
      const done = publishAll(workspaces, arg, run, { root, dryRun });
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
