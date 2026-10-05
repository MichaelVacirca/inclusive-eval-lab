/**
 * npm 11 install-script policy for site/.
 *
 * On npm 11.19.1, `npm install` in site/ ended with "1 package has install scripts not yet covered by allowScripts:
 * esbuild@0.28.2 (postinstall: node install.js)". esbuild came in through vitest 3 -> vite 7. Since vitest 5 / vite 8
 * (#3) it is no longer installed, so on the CI platform (ubuntu-latest, linux x64) no installed package has an install
 * script and site/package.json needs no "allowScripts" entries.
 *
 * These tests keep it that way and stop the policy from widening silently:
 *  - every lockfile package with an install script that npm would install on CI must be explicitly allowed or denied;
 *  - "allowScripts" may only name reviewed packages (esbuild is the only one reviewed), by name or exact pin, never
 *    by wildcard or range;
 *  - site/.npmrc, if present, must not enable install scripts wholesale.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SITE = resolve(__dirname, "../..");

/**
 * Packages whose install scripts have been reviewed. A reviewed package may be allowed (true) or denied (false).
 * esbuild: postinstall only falls back to fetching the hash-checked platform binary when the optional @esbuild/<platform>
 * package is missing, then hard-links it over the bin/esbuild JS shim. It is safe to allow and safe to deny.
 * Adding a name here is the review step; the policy test fails for any entry that is not listed.
 */
const REVIEWED = new Set(["esbuild"]);

/** The platform CI installs on (.github/workflows/ci.yml: runs-on ubuntu-latest). */
const CI_PLATFORM = { os: "linux", cpu: "x64" } as const;

type Platform = { os: string; cpu: string };
type LockEntry = { name?: string; version?: string; hasInstallScript?: boolean; os?: string[]; cpu?: string[] };

const NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

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

/** npm's os/cpu rule: listed values allow, "!value" excludes, a list of only exclusions allows everything else. */
function matches(list: string[] | undefined, value: string): boolean {
  if (!list || list.length === 0) return true;
  if (list.includes(`!${value}`)) return false;
  const positives = list.filter((v) => !v.startsWith("!"));
  return positives.length === 0 || positives.includes(value);
}

/** Lockfile packages with install scripts that npm would install on `platform` and that no entry covers. */
function uncoveredInstallScripts(lock: unknown, allow: Map<string, boolean>, platform: Platform): string[] {
  if (!isPlainObject(lock) || !isPlainObject(lock.packages)) throw new Error("malformed package-lock.json: no packages");
  const out: string[] = [];
  for (const [path, value] of Object.entries(lock.packages)) {
    if (path === "") continue; // the project's own scripts are not dependency install scripts
    const entry = value as LockEntry;
    if (entry.hasInstallScript !== true) continue;
    if (!matches(entry.os, platform.os) || !matches(entry.cpu, platform.cpu)) continue;
    const name = entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    const covered = allow.has(name) || (entry.version !== undefined && allow.has(`${name}@${entry.version}`));
    if (!covered) out.push(`${name}@${entry.version ?? "?"}`);
  }
  return out.sort();
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

const readJson = (file: string): unknown => JSON.parse(readFileSync(join(SITE, file), "utf8"));

describe("site install-script policy (current repository state)", () => {
  it("package.json allowScripts is well-formed and names only reviewed packages", () => {
    const allow = parseAllowScripts(readJson("package.json"));
    expect(unreviewedEntries(allow, REVIEWED)).toEqual([]);
  });

  it("every install script npm would run on CI (linux x64) is explicitly allowed or denied", () => {
    const allow = parseAllowScripts(readJson("package.json"));
    expect(uncoveredInstallScripts(readJson("package-lock.json"), allow, CI_PLATFORM)).toEqual([]);
  });

  it("esbuild, the package npm 11 flagged, is either absent from the lockfile or explicitly covered", () => {
    const lock = readJson("package-lock.json") as { packages: Record<string, LockEntry> };
    const allow = parseAllowScripts(readJson("package.json"));
    const esbuild = lock.packages["node_modules/esbuild"];
    if (esbuild?.hasInstallScript) {
      expect(allow.has("esbuild") || allow.has(`esbuild@${esbuild.version}`)).toBe(true);
    } else {
      expect([...allow.keys()].filter((k) => splitSpec(k).name === "esbuild")).toEqual([]);
    }
  });

  it("site/.npmrc, if present, does not enable install scripts wholesale", () => {
    const file = join(SITE, ".npmrc");
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    expect(npmrcWidening(text, REVIEWED)).toEqual([]);
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
