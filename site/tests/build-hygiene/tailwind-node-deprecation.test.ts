/**
 * @tailwindcss/node < 4.3.1 calls the Node 26-deprecated module.register() as soon as it loads,
 * so `npm test` and `npm run build` printed "[DEP0205] DeprecationWarning: `module.register()` is deprecated".
 * Tailwind 4.3.1 (tailwindlabs/tailwindcss#20028) switched to module.registerHooks() where available.
 * These tests keep the installed, locked and declared versions at or above that fix, and check that loading the
 * package no longer emits DEP0205.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SITE = resolve(__dirname, "../..");
const FIXED = "4.3.1";
const PACKAGES = ["@tailwindcss/node", "@tailwindcss/postcss", "tailwindcss"] as const;

type Version = { major: number; minor: number; patch: number; pre: string | null };

/** Parses a strict x.y.z[-pre] version. Throws on anything else (empty, partial, ranges, leading "v"). */
function parseVersion(v: string): Version {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(v);
  if (!m) throw new Error(`malformed version: ${JSON.stringify(v)}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? null };
}

/** True when `v` >= `min`. Numeric per component; a prerelease sorts before its release. */
function isAtLeast(v: string, min: string): boolean {
  const a = parseVersion(v);
  const b = parseVersion(min);
  for (const k of ["major", "minor", "patch"] as const) if (a[k] !== b[k]) return a[k] > b[k];
  if (a.pre === b.pre) return true;
  if (a.pre === null) return true;
  if (b.pre === null) return false;
  return a.pre >= b.pre;
}

/** Lowest version a caret/tilde/exact range can resolve to. Throws for open-ended or unsupported ranges. */
function rangeFloor(range: string): string {
  const m = /^[\^~]?(\d+(?:\.\d+){0,2})$/.exec(range.trim());
  if (!m) throw new Error(`unsupported range: ${JSON.stringify(range)}`);
  const parts = m[1].split(".");
  while (parts.length < 3) parts.push("0");
  return parts.join(".");
}

function installedVersion(name: string): string {
  // Read the hoisted copy directly: these packages' "exports" maps do not expose ./package.json.
  const pkg = JSON.parse(readFileSync(join(SITE, "node_modules", name, "package.json"), "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string") throw new Error(`${name}: installed package.json has no version`);
  return pkg.version;
}

describe("Tailwind CSS is at or above the DEP0205 fix (4.3.1)", () => {
  for (const name of PACKAGES) {
    it(`installed ${name} >= ${FIXED}`, () => {
      expect(isAtLeast(installedVersion(name), FIXED)).toBe(true);
    });
  }

  it("package-lock.json resolves every Tailwind package at or above the fix", () => {
    const lock = JSON.parse(readFileSync(join(SITE, "package-lock.json"), "utf8")) as {
      packages: Record<string, { version?: string }>;
    };
    for (const name of PACKAGES) {
      const entry = lock.packages[`node_modules/${name}`];
      expect(entry?.version, `${name} missing from package-lock.json`).toBeTypeOf("string");
      expect(isAtLeast(entry.version!, FIXED), `${name}@${entry.version}`).toBe(true);
    }
  });

  it("package.json ranges cannot resolve below the fix", () => {
    const pkg = JSON.parse(readFileSync(join(SITE, "package.json"), "utf8")) as {
      devDependencies?: Record<string, string>;
    };
    for (const name of ["@tailwindcss/postcss", "tailwindcss"]) {
      const range = pkg.devDependencies?.[name];
      expect(range, `${name} missing from devDependencies`).toBeTypeOf("string");
      expect(isAtLeast(rangeFloor(range!), FIXED), `${name}: ${range}`).toBe(true);
    }
  });

  it("loading @tailwindcss/node emits no module.register() deprecation (DEP0205)", () => {
    // A fresh process, so the warning is not hidden by one already emitted in this worker.
    // NODE_OPTIONS is cleared so an inherited --no-deprecation cannot make this pass vacuously.
    const child = spawnSync(process.execPath, ["--trace-deprecation", "-e", 'require("@tailwindcss/node")'], {
      cwd: SITE,
      env: { ...process.env, NODE_OPTIONS: "" },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(child.stderr).not.toContain("DEP0205");
    expect(child.stderr).not.toMatch(/module\.register\(\)` is deprecated/);
  });
});

describe("version helpers: standard behavior, edge cases and failure modes", () => {
  it("compares numerically, not lexically", () => {
    expect(isAtLeast("4.10.0", "4.3.1")).toBe(true);
    expect(isAtLeast("4.3.10", "4.3.9")).toBe(true);
    expect(isAtLeast("10.0.0", "9.99.99")).toBe(true);
  });

  it("treats the exact fixed version as satisfying and anything earlier as not", () => {
    expect(isAtLeast("4.3.1", "4.3.1")).toBe(true);
    expect(isAtLeast("4.3.0", "4.3.1")).toBe(false);
    expect(isAtLeast("4.2.1", "4.3.1")).toBe(false);
    expect(isAtLeast("3.9.9", "4.3.1")).toBe(false);
  });

  it("orders a prerelease before its release", () => {
    expect(isAtLeast("4.3.1-insiders.1", "4.3.1")).toBe(false);
    expect(isAtLeast("4.3.1", "4.3.1-insiders.1")).toBe(true);
    expect(isAtLeast("4.3.2-rc.1", "4.3.1")).toBe(true);
  });

  it("rejects empty and malformed versions instead of guessing", () => {
    for (const bad of ["", " ", "4", "4.3", "v4.3.1", "4.3.1.0", "04.3.1", "^4.3.1", "latest", "4.x.1"]) {
      expect(() => isAtLeast(bad, FIXED), JSON.stringify(bad)).toThrow(/malformed version/);
    }
  });

  it("derives range floors from caret, tilde and exact ranges", () => {
    expect(rangeFloor("^4.3.2")).toBe("4.3.2");
    expect(rangeFloor("~4.3.1")).toBe("4.3.1");
    expect(rangeFloor("4.3.3")).toBe("4.3.3");
    expect(rangeFloor("^4")).toBe("4.0.0");
    expect(isAtLeast(rangeFloor("^4"), FIXED)).toBe(false);
  });

  it("rejects ranges whose floor cannot be read", () => {
    for (const bad of ["", "*", "latest", ">=4.3.1", "4.3.1 || 5", "^4.3.x", "file:../tailwind"]) {
      expect(() => rangeFloor(bad), JSON.stringify(bad)).toThrow(/unsupported range/);
    }
  });
});
