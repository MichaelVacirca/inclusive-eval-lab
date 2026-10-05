/**
 * npm 11 install-script policy for site/, and for the root workspace where it shares packages with site/.
 *
 * On npm 11.19.1, `npm install` in site/ ended with "1 package has install scripts not yet covered by allowScripts:
 * esbuild@0.28.2 (postinstall: node install.js)". esbuild came in through vitest 3 -> vite 7. Since vitest 5 / vite 8
 * (#3) it is no longer installed, so on the CI platform (ubuntu-latest, linux x64) no installed package has an install
 * script.
 *
 * On macOS the same install still ends with "1 package has install scripts not yet covered by allowScripts:
 * fsevents@2.3.3 (install: (install scripts present))" (reproduce with `npm ci --os=darwin --cpu=arm64 --dry-run`).
 * fsevents is darwin-only and optional (site: vitest -> vite 8 -> fsevents; root: vite 7 and rollup -> fsevents), so
 * CI never installs it. It is denied by name, `"allowScripts": { "fsevents": false }`, in site/package.json and in the
 * root package.json: npm reads allowScripts from the project root only, and site/ is its own project, not a root
 * workspace. That is the shape `npm install-scripts deny fsevents` writes. See REVIEWED for why denying is safe.
 *
 * These tests keep it that way and stop the policy from widening silently:
 *  - every lockfile package with an install script that npm would install on a developer platform (DEV_PLATFORMS,
 *    which includes CI's linux x64 and macOS) must be explicitly allowed or denied;
 *  - "allowScripts" may only name reviewed packages (REVIEWED), by name or exact pin, never by wildcard or range;
 *  - fsevents stays denied by name in both package.json files, and every locked fsevents is the reviewed tarball;
 *  - the root package.json follows the same rules, makes the same decision as site/ for every install-script package
 *    both lockfiles contain, and leaves no root install script undecided except those in ROOT_UNDECIDED;
 *  - site/.npmrc and the root .npmrc, if present, must not enable install scripts wholesale.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SITE = resolve(__dirname, "../..");
const ROOT = resolve(SITE, "..");

/**
 * Packages whose install scripts have been reviewed. A reviewed package may be allowed (true) or denied (false).
 * esbuild: postinstall only falls back to fetching the hash-checked platform binary when the optional @esbuild/<platform>
 * package is missing, then hard-links it over the bin/esbuild JS shim. It is safe to allow and safe to deny.
 * fsevents (reviewed at FSEVENTS_REVIEWED): the tarball has no preinstall, install or postinstall script and no
 * binding.gyp. The lockfile's hasInstallScript comes from the registry metadata, where the publishing npm (9.6.7) added
 * "install": "node-gyp rebuild" because binding.gyp was in the publisher's tree. The tarball ships fsevents.node, a
 * prebuilt universal (x86_64 + arm64) Mach-O N-API addon that fsevents.js requires directly, so nothing needs building.
 * Installing from the lockfile, npm finds no script to run. Working from full registry metadata (e.g. --before), it
 * runs node-gyp rebuild, which fails ("binding.gyp not found"), and npm then drops the optional package. Denying
 * loses nothing on macOS and avoids that failure. Denied.
 * Adding a name here is the review step; the policy test fails for any entry that is not listed.
 */
const REVIEWED = new Set(["esbuild", "fsevents"]);

/**
 * The fsevents tarball the deny was reviewed against (registry tarball, sha512 checked against both lockfiles).
 * A lockfile that locks any other fsevents fails below until someone re-inspects the new tarball and updates this.
 */
const FSEVENTS_REVIEWED = {
  version: "2.3.3",
  integrity: "sha512-5xoDfX+fL7faATnagmWPpbFtwh/R77WmMMqqHGS65C3vvB0YHrgF+B1YmZ3441tMj5n63k0212XNoJwzlhffQw==",
} as const;

/** The platform CI installs on (.github/workflows/ci.yml: runs-on ubuntu-latest). */
const CI_PLATFORM = { os: "linux", cpu: "x64" } as const;

/**
 * Platforms developers install on: CI, macOS on Apple silicon and Intel, Windows, and linux arm64 (containers on Apple
 * silicon). npm shows what each would print with `npm ci --os=<os> --cpu=<cpu> --dry-run`.
 */
const DEV_PLATFORMS: readonly Platform[] = [
  CI_PLATFORM,
  { os: "darwin", cpu: "arm64" },
  { os: "darwin", cpu: "x64" },
  { os: "win32", cpu: "x64" },
  { os: "linux", cpu: "arm64" },
];

/**
 * Root-workspace packages whose install scripts are still undecided in the root package.json. esbuild@0.27.4 reaches
 * the root through vitest 3 -> vite 7 and tsup, and the root install notice lists it on every platform. Deciding it is
 * separate from the fsevents decision. Listing it here lets any other new root install script fail the tests; once
 * esbuild is decided, remove it from this set.
 */
const ROOT_UNDECIDED = new Set(["esbuild"]);

type Platform = { os: string; cpu: string };
type LockEntry = {
  name?: string;
  version?: string;
  integrity?: string;
  hasInstallScript?: boolean;
  os?: string[];
  cpu?: string[];
};
type Policy = { allow: Map<string, boolean>; lock: unknown };

const NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PLATFORM_VALUE = /^[a-z][a-z0-9]*$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Splits "name" or "name@1.2.3" (scoped names included). */
function splitSpec(key: string): { name: string; version: string | null } {
  const at = key.indexOf("@", key.startsWith("@") ? 1 : 0);
  return at === -1 ? { name: key, version: null } : { name: key.slice(0, at), version: key.slice(at + 1) };
}

/**
 * Reads package.json "allowScripts". Only the shapes `npm install-scripts approve|deny` writes are accepted:
 * "name" or "name@exact.version" keys with boolean values. Throws on anything else.
 */
function parseAllowScripts(manifest: unknown): Map<string, boolean> {
  if (!isPlainObject(manifest)) throw new Error("malformed package.json: expected an object");
  const raw = manifest.allowScripts;
  if (raw === undefined) return new Map();
  if (!isPlainObject(raw)) throw new Error("malformed allowScripts: expected an object of package -> boolean");
  const out = new Map<string, boolean>();
  for (const [key, value] of Object.entries(raw)) {
    if (key.includes("*")) throw new Error(`wildcard allowScripts entry is not allowed: ${JSON.stringify(key)}`);
    const { name, version } = splitSpec(key);
    if (!NAME.test(name)) throw new Error(`malformed allowScripts entry: ${JSON.stringify(key)}`);
    if (version !== null && !EXACT.test(version)) {
      throw new Error(`allowScripts entry must be a name or an exact pin, not a range: ${JSON.stringify(key)}`);
    }
    if (typeof value !== "boolean") throw new Error(`allowScripts[${JSON.stringify(key)}] must be true or false`);
    out.set(key, value);
  }
  return out;
}

/** Entries that name a package nobody has reviewed. */
function unreviewedEntries(allow: Map<string, boolean>, reviewed: Set<string>): string[] {
  return [...allow.keys()].filter((key) => !reviewed.has(splitSpec(key).name));
}

/** The allowScripts entries for one package, name-only and pinned, sorted by key. */
function entriesFor(allow: Map<string, boolean>, name: string): [string, boolean][] {
  return [...allow].filter(([key]) => splitSpec(key).name === name).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** npm's os/cpu rule: listed values allow, "!value" excludes, a list of only exclusions allows everything else. */
function matches(list: string[] | undefined, value: string): boolean {
  if (!list || list.length === 0) return true;
  if (list.includes(`!${value}`)) return false;
  const positives = list.filter((v) => !v.startsWith("!"));
  return positives.length === 0 || positives.includes(value);
}

/** The lockfile's "packages" map. Throws when there is none. */
function lockPackages(lock: unknown): Record<string, unknown> {
  if (!isPlainObject(lock) || !isPlainObject(lock.packages)) throw new Error("malformed package-lock.json: no packages");
  return lock.packages;
}

/** The package a lockfile entry installs: its "name" (set for aliases) or the path after the last node_modules/. */
function lockedName(path: string, entry: LockEntry): string {
  return entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
}

/** Lockfile packages with install scripts that npm would install on `platform` and that no entry covers. */
function uncoveredInstallScripts(lock: unknown, allow: Map<string, boolean>, platform: Platform): string[] {
  const out: string[] = [];
  for (const [path, value] of Object.entries(lockPackages(lock))) {
    if (path === "") continue; // the project's own scripts are not dependency install scripts
    const entry = value as LockEntry;
    if (entry.hasInstallScript !== true) continue;
    if (!matches(entry.os, platform.os) || !matches(entry.cpu, platform.cpu)) continue;
    const name = lockedName(path, entry);
    const covered = allow.has(name) || (entry.version !== undefined && allow.has(`${name}@${entry.version}`));
    if (!covered) out.push(`${name}@${entry.version ?? "?"}`);
  }
  return out.sort();
}

/**
 * uncoveredInstallScripts on several platforms at once: "name@version" -> the platforms ("os/cpu") it is uncovered on.
 * Throws on an empty platform list, which would pass vacuously, and on a malformed platform.
 */
function uncoveredOnPlatforms(
  lock: unknown,
  allow: Map<string, boolean>,
  platforms: readonly Platform[],
): Record<string, string[]> {
  if (platforms.length === 0) throw new Error("no platforms to check");
  const out: Record<string, string[]> = {};
  for (const platform of platforms) {
    const valid =
      isPlainObject(platform) &&
      typeof platform.os === "string" &&
      typeof platform.cpu === "string" &&
      PLATFORM_VALUE.test(platform.os) &&
      PLATFORM_VALUE.test(platform.cpu);
    if (!valid) throw new Error(`malformed platform: ${JSON.stringify(platform)}`);
    const label = `${platform.os}/${platform.cpu}`;
    for (const spec of uncoveredInstallScripts(lock, allow, platform)) {
      const labels = (out[spec] ??= []);
      if (!labels.includes(label)) labels.push(label);
    }
  }
  return out;
}

/** Names of the lockfile packages that have an install script, on any platform. */
function installScriptNames(lock: unknown): Set<string> {
  const out = new Set<string>();
  for (const [path, value] of Object.entries(lockPackages(lock))) {
    if (path === "" || !isPlainObject(value)) continue;
    if (value.hasInstallScript === true) out.add(lockedName(path, value as LockEntry));
  }
  return out;
}

/**
 * Packages with an install script in both lockfiles whose allowScripts entries differ between the two projects.
 * Each project root reads only its own package.json, so a shared package needs the same decision in both.
 */
function decisionDrift(a: Policy, b: Policy): string[] {
  const inB = installScriptNames(b.lock);
  const shared = [...installScriptNames(a.lock)].filter((name) => inB.has(name)).sort();
  const show = (allow: Map<string, boolean>, name: string) =>
    JSON.stringify(Object.fromEntries(entriesFor(allow, name)));
  return shared
    .filter((name) => show(a.allow, name) !== show(b.allow, name))
    .map((name) => `${name}: ${show(a.allow, name)} != ${show(b.allow, name)}`);
}

/** .npmrc settings that would widen the policy outside package.json. */
function npmrcWidening(text: string, reviewed: Set<string>): string[] {
  const problems: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const eq = line.indexOf("=");
    const key = (eq === -1 ? line : line.slice(0, eq)).trim();
    const value = (eq === -1 ? "true" : line.slice(eq + 1)).trim();
    if (key === "dangerously-allow-all-scripts" && value !== "false") problems.push(line);
    if (key === "allow-scripts" || key === "allow-scripts[]") {
      for (const name of value.split(",").map((s) => s.trim()).filter(Boolean)) {
        if (name.includes("*") || !reviewed.has(splitSpec(name).name)) problems.push(line);
      }
    }
  }
  return problems;
}

const readJson = (dir: string, file: string): unknown => JSON.parse(readFileSync(join(dir, file), "utf8"));
const readNpmrc = (dir: string): string => {
  const file = join(dir, ".npmrc");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
};
const policyOf = (dir: string): Policy => ({
  allow: parseAllowScripts(readJson(dir, "package.json")),
  lock: readJson(dir, "package-lock.json"),
});

describe("site install-script policy (current repository state)", () => {
  it("package.json allowScripts is well-formed and names only reviewed packages", () => {
    const allow = parseAllowScripts(readJson(SITE, "package.json"));
    expect(unreviewedEntries(allow, REVIEWED)).toEqual([]);
  });

  it("every install script npm would run on CI (linux x64) is explicitly allowed or denied", () => {
    const { allow, lock } = policyOf(SITE);
    expect(uncoveredInstallScripts(lock, allow, CI_PLATFORM)).toEqual([]);
  });

  it("every install script npm would run on a developer platform (macOS, Windows, linux) is allowed or denied", () => {
    const { allow, lock } = policyOf(SITE);
    expect(uncoveredOnPlatforms(lock, allow, DEV_PLATFORMS)).toEqual({});
  });

  it("esbuild, the package npm 11 flagged, is either absent from the lockfile or explicitly covered", () => {
    const lock = readJson(SITE, "package-lock.json") as { packages: Record<string, LockEntry> };
    const allow = parseAllowScripts(readJson(SITE, "package.json"));
    const esbuild = lock.packages["node_modules/esbuild"];
    if (esbuild?.hasInstallScript) {
      expect(allow.has("esbuild") || allow.has(`esbuild@${esbuild.version}`)).toBe(true);
    } else {
      expect([...allow.keys()].filter((k) => splitSpec(k).name === "esbuild")).toEqual([]);
    }
  });

  it("site/.npmrc, if present, does not enable install scripts wholesale", () => {
    expect(npmrcWidening(readNpmrc(SITE), REVIEWED)).toEqual([]);
  });
});

describe("root workspace install-script policy (current repository state)", () => {
  it("root package.json allowScripts is well-formed and names only reviewed packages", () => {
    const allow = parseAllowScripts(readJson(ROOT, "package.json"));
    expect(unreviewedEntries(allow, REVIEWED)).toEqual([]);
  });

  it("root package.json makes the same decision as site/ for every install-script package in both lockfiles", () => {
    expect(decisionDrift(policyOf(SITE), policyOf(ROOT))).toEqual([]);
  });

  it("every root install script on a developer platform is allowed or denied, apart from ROOT_UNDECIDED", () => {
    const { allow, lock } = policyOf(ROOT);
    const uncovered = Object.keys(uncoveredOnPlatforms(lock, allow, DEV_PLATFORMS));
    expect(uncovered.filter((spec) => !ROOT_UNDECIDED.has(splitSpec(spec).name))).toEqual([]);
  });

  it("ROOT_UNDECIDED names only packages that are still undecided at the root", () => {
    const { allow, lock } = policyOf(ROOT);
    const uncovered = Object.keys(uncoveredOnPlatforms(lock, allow, DEV_PLATFORMS));
    const undecided = new Set(uncovered.map((spec) => splitSpec(spec).name));
    expect([...ROOT_UNDECIDED].filter((name) => !undecided.has(name))).toEqual([]);
  });

  it("root .npmrc, if present, does not enable install scripts wholesale", () => {
    expect(npmrcWidening(readNpmrc(ROOT), REVIEWED)).toEqual([]);
  });
});

describe("fsevents decision: denied by name, never allowed", () => {
  // `npm install-scripts prune` run on linux drops this entry ("package not installed"): fsevents never installs there.
  it.each([
    ["site", SITE],
    ["root", ROOT],
  ])("%s package.json denies fsevents by name and has no other fsevents entry", (_label, dir) => {
    expect(entriesFor(parseAllowScripts(readJson(dir, "package.json")), "fsevents")).toEqual([["fsevents", false]]);
  });

  it.each([
    ["site", SITE],
    ["root", ROOT],
  ])("any fsevents in the %s lockfile is the tarball the deny was reviewed against", (_label, dir) => {
    const locked = Object.entries(lockPackages(readJson(dir, "package-lock.json")) as Record<string, LockEntry>)
      .filter(([path, entry]) => path !== "" && isPlainObject(entry) && lockedName(path, entry) === "fsevents")
      .map(([path, entry]) => ({ path, version: entry.version, integrity: entry.integrity }));
    expect(locked).toEqual(locked.map(({ path }) => ({ path, ...FSEVENTS_REVIEWED })));
  });
});

describe("parseAllowScripts: standard behavior", () => {
  it("treats a missing allowScripts field as an empty policy", () => {
    expect(parseAllowScripts({ name: "site" }).size).toBe(0);
  });

  it("accepts name-only and exact-pin entries, allowed or denied", () => {
    const allow = parseAllowScripts({ allowScripts: { esbuild: false, "esbuild@0.28.2": true, "@scope/pkg@1.0.0-rc.1": true } });
    expect([...allow]).toEqual([
      ["esbuild", false],
      ["esbuild@0.28.2", true],
      ["@scope/pkg@1.0.0-rc.1", true],
    ]);
  });
});

describe("parseAllowScripts: failure modes", () => {
  it("rejects wildcard entries", () => {
    for (const key of ["*", "**", "esbuild*", "@esbuild/*", "esbuild@*"]) {
      expect(() => parseAllowScripts({ allowScripts: { [key]: true } }), key).toThrow(/wildcard/);
    }
  });

  it("rejects range entries that would silently cover future versions", () => {
    for (const key of ["esbuild@^0.28.0", "esbuild@1 || 2", "esbuild@>=0.28.2", "esbuild@latest", "esbuild@"]) {
      expect(() => parseAllowScripts({ allowScripts: { [key]: true } }), key).toThrow(/exact pin/);
    }
  });

  it("rejects empty and malformed package names", () => {
    for (const key of ["", " ", "@", "@scope", "@scope/", "Esbuild", "../esbuild"]) {
      expect(() => parseAllowScripts({ allowScripts: { [key]: true } }), JSON.stringify(key)).toThrow(/malformed allowScripts entry/);
    }
  });

  it("rejects non-boolean values", () => {
    for (const value of ["true", "yes", 1, 0, null, {}, []]) {
      expect(() => parseAllowScripts({ allowScripts: { esbuild: value } }), JSON.stringify(value)).toThrow(/true or false/);
    }
  });

  it("rejects a malformed allowScripts field or manifest", () => {
    for (const allowScripts of [null, [], ["esbuild"], "esbuild", true, 1]) {
      expect(() => parseAllowScripts({ allowScripts }), JSON.stringify(allowScripts)).toThrow(/malformed allowScripts/);
    }
    for (const manifest of [null, undefined, [], "{}", 42]) {
      expect(() => parseAllowScripts(manifest), JSON.stringify(manifest)).toThrow(/malformed package.json/);
    }
  });
});

describe("unreviewedEntries: the policy cannot widen silently", () => {
  it("accepts reviewed packages whether allowed, denied or pinned", () => {
    const allow = parseAllowScripts({ allowScripts: { esbuild: true, "esbuild@0.28.2": false } });
    expect(unreviewedEntries(allow, REVIEWED)).toEqual([]);
  });

  it("reports every entry for a package nobody reviewed", () => {
    const allow = parseAllowScripts({ allowScripts: { esbuild: true, sharp: true, "@scope/native@1.2.3": false } });
    expect(unreviewedEntries(allow, REVIEWED)).toEqual(["sharp", "@scope/native@1.2.3"]);
  });

  it("an empty review list rejects every entry", () => {
    expect(unreviewedEntries(parseAllowScripts({ allowScripts: { esbuild: true } }), new Set())).toEqual(["esbuild"]);
  });
});

describe("uncoveredInstallScripts: coverage of lockfile install scripts", () => {
  const esbuildLock = {
    packages: {
      "": { name: "site", hasInstallScript: true },
      "node_modules/esbuild": { version: "0.28.2", hasInstallScript: true },
      "node_modules/react": { version: "19.2.3" },
    },
  };

  it("reports a missing entry for a package with an install script", () => {
    expect(uncoveredInstallScripts(esbuildLock, new Map(), CI_PLATFORM)).toEqual(["esbuild@0.28.2"]);
  });

  it("counts an explicit denial as covered, the same as an approval", () => {
    expect(uncoveredInstallScripts(esbuildLock, new Map([["esbuild", false]]), CI_PLATFORM)).toEqual([]);
    expect(uncoveredInstallScripts(esbuildLock, new Map([["esbuild", true]]), CI_PLATFORM)).toEqual([]);
  });

  it("requires a pinned entry to match the locked version", () => {
    expect(uncoveredInstallScripts(esbuildLock, new Map([["esbuild@0.28.2", true]]), CI_PLATFORM)).toEqual([]);
    expect(uncoveredInstallScripts(esbuildLock, new Map([["esbuild@0.27.0", true]]), CI_PLATFORM)).toEqual(["esbuild@0.28.2"]);
  });

  it("derives scoped and nested package names from lockfile paths", () => {
    const lock = { packages: { "node_modules/a/node_modules/@scope/native": { version: "1.0.0", hasInstallScript: true } } };
    expect(uncoveredInstallScripts(lock, new Map(), CI_PLATFORM)).toEqual(["@scope/native@1.0.0"]);
    expect(uncoveredInstallScripts(lock, new Map([["@scope/native", false]]), CI_PLATFORM)).toEqual([]);
  });

  it("skips packages npm would not install on the target platform", () => {
    const lock = {
      packages: {
        "node_modules/fsevents": { version: "2.3.3", hasInstallScript: true, optional: true, os: ["darwin"] },
        "node_modules/not-linux": { version: "1.0.0", hasInstallScript: true, os: ["!linux"] },
        "node_modules/arm-only": { version: "1.0.0", hasInstallScript: true, os: ["linux"], cpu: ["arm64"] },
      },
    };
    expect(uncoveredInstallScripts(lock, new Map(), CI_PLATFORM)).toEqual([]);
    expect(uncoveredInstallScripts(lock, new Map(), { os: "darwin", cpu: "arm64" })).toEqual([
      "fsevents@2.3.3",
      "not-linux@1.0.0",
    ]);
    expect(uncoveredInstallScripts(lock, new Map(), { os: "linux", cpu: "arm64" })).toEqual(["arm-only@1.0.0"]);
  });

  it("handles an empty lockfile and rejects a malformed one", () => {
    expect(uncoveredInstallScripts({ packages: {} }, new Map(), CI_PLATFORM)).toEqual([]);
    for (const lock of [null, {}, { packages: null }, { packages: [] }, "lock"]) {
      expect(() => uncoveredInstallScripts(lock, new Map(), CI_PLATFORM), JSON.stringify(lock)).toThrow(/malformed package-lock/);
    }
  });
});

describe("npmrcWidening: .npmrc cannot bypass the package.json policy", () => {
  it("accepts an empty file, comments and unrelated settings", () => {
    expect(npmrcWidening("", REVIEWED)).toEqual([]);
    expect(npmrcWidening("# comment\n; comment\n\nfund=false\nengine-strict=true\n", REVIEWED)).toEqual([]);
    expect(npmrcWidening("dangerously-allow-all-scripts=false\nallow-scripts=esbuild\n", REVIEWED)).toEqual([]);
  });

  it("flags allow-all, wildcard and unreviewed allow-scripts settings", () => {
    expect(npmrcWidening("dangerously-allow-all-scripts=true", REVIEWED)).toEqual(["dangerously-allow-all-scripts=true"]);
    expect(npmrcWidening("dangerously-allow-all-scripts", REVIEWED)).toEqual(["dangerously-allow-all-scripts"]);
    expect(npmrcWidening("allow-scripts=*", REVIEWED)).toEqual(["allow-scripts=*"]);
    expect(npmrcWidening("allow-scripts=esbuild,sharp", REVIEWED)).toEqual(["allow-scripts=esbuild,sharp"]);
    expect(npmrcWidening("allow-scripts[]=sharp", REVIEWED)).toEqual(["allow-scripts[]=sharp"]);
  });
});

describe("uncoveredOnPlatforms: coverage on every developer platform", () => {
  const lock = {
    packages: {
      "": { name: "site", hasInstallScript: true },
      "node_modules/esbuild": { version: "0.28.2", hasInstallScript: true },
      "node_modules/fsevents": { version: "2.3.3", hasInstallScript: true, optional: true, os: ["darwin"] },
      "node_modules/arm-only": { version: "1.0.0", hasInstallScript: true, os: ["linux"], cpu: ["arm64"] },
      "node_modules/react": { version: "19.2.3" },
    },
  };

  it("reports each uncovered install script with the platforms it would run on", () => {
    expect(uncoveredOnPlatforms(lock, new Map(), DEV_PLATFORMS)).toEqual({
      "esbuild@0.28.2": ["linux/x64", "darwin/arm64", "darwin/x64", "win32/x64", "linux/arm64"],
      "fsevents@2.3.3": ["darwin/arm64", "darwin/x64"],
      "arm-only@1.0.0": ["linux/arm64"],
    });
  });

  it("finds the macOS-only install script that a CI-only check misses", () => {
    const allow = new Map([["esbuild", true], ["arm-only", false]]);
    expect(uncoveredOnPlatforms(lock, allow, [CI_PLATFORM])).toEqual({});
    expect(uncoveredOnPlatforms(lock, allow, DEV_PLATFORMS)).toEqual({
      "fsevents@2.3.3": ["darwin/arm64", "darwin/x64"],
    });
  });

  it("returns nothing once every install script is allowed or denied", () => {
    const allow = new Map([["esbuild", true], ["fsevents", false], ["arm-only@1.0.0", false]]);
    expect(uncoveredOnPlatforms(lock, allow, DEV_PLATFORMS)).toEqual({});
  });

  it("lists a platform once when it is given twice", () => {
    expect(uncoveredOnPlatforms(lock, new Map(), [CI_PLATFORM, { os: "linux", cpu: "x64" }])).toEqual({
      "esbuild@0.28.2": ["linux/x64"],
    });
  });

  it("handles an empty lockfile", () => {
    expect(uncoveredOnPlatforms({ packages: {} }, new Map(), DEV_PLATFORMS)).toEqual({});
  });

  it("rejects an empty platform list, which would pass vacuously", () => {
    expect(() => uncoveredOnPlatforms(lock, new Map(), [])).toThrow(/no platforms/);
  });

  it("rejects malformed platforms", () => {
    const bad = [
      { os: "", cpu: "x64" },
      { os: "darwin", cpu: "" },
      { os: "!linux", cpu: "x64" },
      { os: "Darwin", cpu: "arm64" },
      { os: "darwin/arm64", cpu: "arm64" },
      { os: "darwin" },
      { os: 1, cpu: "x64" },
      null,
      "darwin/arm64",
    ];
    for (const platform of bad) {
      const platforms = [platform as unknown as Platform];
      expect(() => uncoveredOnPlatforms(lock, new Map(), platforms), JSON.stringify(platform)).toThrow(/malformed platform/);
    }
  });

  it("rejects a malformed lockfile", () => {
    for (const bad of [null, {}, { packages: null }, { packages: [] }, "lock"]) {
      expect(() => uncoveredOnPlatforms(bad, new Map(), DEV_PLATFORMS), JSON.stringify(bad)).toThrow(/malformed package-lock/);
    }
  });
});

describe("lockedName and installScriptNames: reading package names from a lockfile", () => {
  it("derives names from nested and scoped paths, and prefers the entry's own name (aliases)", () => {
    expect(lockedName("node_modules/fsevents", {})).toBe("fsevents");
    expect(lockedName("node_modules/a/node_modules/@scope/native", {})).toBe("@scope/native");
    expect(lockedName("node_modules/alias", { name: "real-name" })).toBe("real-name");
  });

  it("collects every package with an install script on any platform, once", () => {
    const lock = {
      packages: {
        "": { name: "root", hasInstallScript: true },
        "node_modules/esbuild": { version: "0.27.4", hasInstallScript: true },
        "node_modules/fsevents": { version: "2.3.3", hasInstallScript: true, os: ["darwin"] },
        "node_modules/a/node_modules/fsevents": { version: "2.3.2", hasInstallScript: true, os: ["darwin"] },
        "node_modules/react": { version: "19.2.3" },
        "node_modules/flag-not-true": { version: "1.0.0", hasInstallScript: "true" },
        "node_modules/broken": null,
      },
    };
    expect([...installScriptNames(lock)].sort()).toEqual(["esbuild", "fsevents"]);
  });

  it("handles an empty lockfile and rejects a malformed one", () => {
    expect(installScriptNames({ packages: {} }).size).toBe(0);
    for (const bad of [null, {}, { packages: null }, { packages: [] }, "lock"]) {
      expect(() => installScriptNames(bad), JSON.stringify(bad)).toThrow(/malformed package-lock/);
    }
  });
});

describe("entriesFor: one package's allowScripts entries", () => {
  it("returns the name-only and pinned entries for the package, sorted", () => {
    const allow = parseAllowScripts({ allowScripts: { "fsevents@2.3.3": true, esbuild: true, fsevents: false } });
    expect(entriesFor(allow, "fsevents")).toEqual([
      ["fsevents", false],
      ["fsevents@2.3.3", true],
    ]);
    expect(entriesFor(allow, "esbuild")).toEqual([["esbuild", true]]);
  });

  it("does not match look-alike names", () => {
    const allow = parseAllowScripts({
      allowScripts: { "fsevents-legacy": false, "@scope/fsevents": false, fsevent: false, "@fsevents/x@1.0.0": false },
    });
    expect(entriesFor(allow, "fsevents")).toEqual([]);
    expect(entriesFor(allow, "@scope/fsevents")).toEqual([["@scope/fsevents", false]]);
  });

  it("returns nothing for an empty policy or an empty name", () => {
    expect(entriesFor(new Map(), "fsevents")).toEqual([]);
    expect(entriesFor(parseAllowScripts({ allowScripts: { fsevents: false } }), "")).toEqual([]);
  });
});

describe("decisionDrift: site/ and the root workspace must not diverge", () => {
  const withFsevents = {
    packages: { "node_modules/fsevents": { version: "2.3.3", hasInstallScript: true, optional: true, os: ["darwin"] } },
  };
  const policy = (allowScripts: Record<string, boolean>, lock: unknown = withFsevents): Policy => ({
    allow: parseAllowScripts({ allowScripts }),
    lock,
  });

  it("accepts the same decision in both projects", () => {
    expect(decisionDrift(policy({ fsevents: false }), policy({ fsevents: false, esbuild: true }))).toEqual([]);
  });

  it("reports a flipped, missing or differently pinned decision", () => {
    expect(decisionDrift(policy({ fsevents: false }), policy({ fsevents: true }))).toEqual([
      'fsevents: {"fsevents":false} != {"fsevents":true}',
    ]);
    expect(decisionDrift(policy({ fsevents: false }), policy({}))).toEqual(['fsevents: {"fsevents":false} != {}']);
    expect(decisionDrift(policy({}), policy({ fsevents: false }))).toEqual(['fsevents: {} != {"fsevents":false}']);
    expect(decisionDrift(policy({ fsevents: false }), policy({ "fsevents@2.3.3": false }))).toEqual([
      'fsevents: {"fsevents":false} != {"fsevents@2.3.3":false}',
    ]);
  });

  it("ignores packages that only one project locks with an install script", () => {
    const rootOnly = { packages: { "node_modules/esbuild": { version: "0.27.4", hasInstallScript: true } } };
    expect(decisionDrift(policy({}, { packages: {} }), policy({ esbuild: true }, rootOnly))).toEqual([]);
    const noScript = { packages: { "node_modules/fsevents": { version: "2.3.3" } } };
    expect(decisionDrift(policy({ fsevents: false }), policy({}, noScript))).toEqual([]);
  });

  it("handles empty lockfiles and rejects malformed ones", () => {
    expect(decisionDrift(policy({}, { packages: {} }), policy({}, { packages: {} }))).toEqual([]);
    for (const bad of [null, {}, { packages: null }, "lock"]) {
      expect(() => decisionDrift(policy({}), policy({}, bad)), JSON.stringify(bad)).toThrow(/malformed package-lock/);
      expect(() => decisionDrift(policy({}, bad), policy({})), JSON.stringify(bad)).toThrow(/malformed package-lock/);
    }
  });
});
