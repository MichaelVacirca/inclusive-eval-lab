import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type Sandbox,
  type Step,
  allSteps,
  loadYaml,
  makeSandbox,
  pathWithout,
  resolveEnv,
  runStep,
  stepNamed,
  writeSpy,
  writeStub,
} from "./harness";

const doc = loadYaml(".github/workflows/ci.yml");
const job = doc.jobs["lint-workflows"];
const steps: Step[] = job?.steps ?? [];
const lint = stepNamed(allSteps(doc), "Run actionlint");
const script = lint.run ?? "";
const PINNED = resolveEnv(lint.env, { inputs: {} });

const VERSION = "1.7.12";
const ASSET = `actionlint_${VERSION}_linux_amd64.tar.gz`;
const ASSET_URL = `https://github.com/rhysd/actionlint/releases/download/v${VERSION}/${ASSET}`;

// https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_checksums.txt
const RELEASE_CHECKSUMS = `
5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644  actionlint_1.7.12_darwin_amd64.tar.gz
aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f  actionlint_1.7.12_darwin_arm64.tar.gz
7170cc3db006f83154583dc385c84bea3f6ee767a167bb9ca41de6593ebbb186  actionlint_1.7.12_freebsd_386.tar.gz
3de1b027d0b749e81d6d972cbf5d14dc708a275248da1ba4eed4a9af707d1339  actionlint_1.7.12_freebsd_amd64.tar.gz
72a44b32c2d032700e6d0c23ca2f540b67519ec68db098ddfcfa96059e61f723  actionlint_1.7.12_linux_386.tar.gz
8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8  actionlint_1.7.12_linux_amd64.tar.gz
325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6  actionlint_1.7.12_linux_arm64.tar.gz
ae4a0a5227578e66f5d00ee02788d5c64fdae1fa6484ab88ceaeee9359c28fa4  actionlint_1.7.12_linux_armv6.tar.gz
cdc8643b2c8dc890c76ad16095da97e75f86572805cc3573cc13f31ea0f19127  actionlint_1.7.12_windows_386.zip
6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9  actionlint_1.7.12_windows_amd64.zip
cadcf7ea4efe3a68728893813643cebe1185e5b1d4be5b96245f65c9a4d5ea41  actionlint_1.7.12_windows_arm64.zip
`;
const checksums = new Map(
  RELEASE_CHECKSUMS.trim()
    .split("\n")
    .map((line) => line.split(/\s+/).reverse() as [string, string]),
);

/** Index of the first line of the run script matching re, or -1. */
function lineOf(re: RegExp): number {
  return script.split("\n").findIndex((l) => re.test(l));
}

describe("lint-workflows job", () => {
  it("exists, named for what it does, on a Linux x64 runner", () => {
    expect(job?.name).toBe("Lint workflows");
    expect(job?.["runs-on"]).toBe("ubuntu-latest");
  });

  it("only gets read access to repository contents", () => {
    expect(job.permissions).toEqual({ contents: "read" });
  });

  it("checks out without keeping git credentials, then lints", () => {
    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual({ uses: "actions/checkout@v7", with: { "persist-credentials": false } });
    expect(steps[1]).toBe(lint);
  });

  it("uses no action but checkout, and no secrets", () => {
    expect(steps.filter((s) => s.uses).map((s) => s.uses)).toEqual(["actions/checkout@v7"]);
    expect(JSON.stringify(job)).not.toMatch(/secrets\.|\$\{\{/);
  });
});

describe("pinned actionlint", () => {
  it("is exactly version 1.7.12", () => {
    expect(PINNED.ACTIONLINT_VERSION).toBe(VERSION);
  });

  it("is checked against a full lowercase sha256", () => {
    expect(PINNED.ACTIONLINT_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is checked against the release's hash for the linux_amd64 tarball", () => {
    expect(checksums.get(ASSET)).toBeDefined();
    expect(PINNED.ACTIONLINT_SHA256).toBe(checksums.get(ASSET));
  });

  it("downloads that version's linux_amd64 release asset from rhysd/actionlint", () => {
    const expanded = script.replace(/\$\{ACTIONLINT_VERSION\}/g, PINNED.ACTIONLINT_VERSION);
    expect(expanded).toContain(`"${ASSET_URL}"`);
  });

  it("checks the runner and shellcheck, downloads, verifies, extracts, then runs, in that order", () => {
    const order = [
      lineOf(/RUNNER_OS.*RUNNER_ARCH/),
      lineOf(/command -v shellcheck/),
      lineOf(/^\s*curl\s/),
      lineOf(/^\s*sha256sum -c /),
      lineOf(/^\s*tar\s/),
      lineOf(/^\s*"\$RUNNER_TEMP\/actionlint\/actionlint"/),
    ];
    expect(order.every((i) => i >= 0), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("verifies with the pinned hash variable, not a value fetched alongside the tarball", () => {
    expect(script).toMatch(/^\s*sha256sum -c <<< "\$ACTIONLINT_SHA256  \$tarball"$/m);
    expect(script).not.toMatch(/checksums/);
    expect(script.match(/\bcurl\s/g)).toHaveLength(1);
  });

  it("does not pipe a download into a shell, use latest, or follow a branch", () => {
    const text = JSON.stringify(steps);
    expect(script).not.toMatch(/\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(ba|da|z)?sh\b/);
    expect(script).not.toMatch(/\bwget\b/);
    expect(text).not.toMatch(/latest/i);
    expect(text).not.toMatch(/@(main|master)\b/);
  });
});

// The behavioral tests serve a real .tar.gz shaped like the release (with a
// stub actionlint inside) and run the step's script with the real sha256sum
// and tar behind spies, so the checksum check is the real one.

const ON_LINUX_X64 = { RUNNER_OS: "Linux", RUNNER_ARCH: "X64" };

let sb: Sandbox;
let root: string;
let tarball: string;
let extracted: string;
let release: { path: string; sha256: string };

beforeEach(() => {
  sb = makeSandbox();
  root = dirname(sb.work);
  tarball = join(sb.runnerTemp, ASSET);
  extracted = join(sb.runnerTemp, "actionlint");
  writeStub(sb, join(sb.bin, "shellcheck"), "shellcheck");
  writeSpy(sb, "sha256sum");
  writeSpy(sb, "tar");
  withServingCurl();
  release = fakeRelease();
  serve(release.path);
});

/** A tarball laid out like the real release, with a stub actionlint at its root. */
function fakeRelease(members: string[] = ["LICENSE.txt", "README.md", "docs", "actionlint"]) {
  const src = join(root, "release");
  mkdirSync(join(src, "docs"), { recursive: true });
  writeFileSync(join(src, "LICENSE.txt"), "MIT\n");
  writeFileSync(join(src, "README.md"), "# actionlint\n");
  writeFileSync(join(src, "docs", "usage.md"), "usage\n");
  writeStub(sb, join(src, "actionlint"), "actionlint");
  const path = join(root, `release-${members.length}.tar.gz`);
  const r = spawnSync("tar", ["-czf", path, "-C", src, ...members]);
  if (r.status !== 0) throw new Error(`tar failed: ${r.stderr}`);
  return { path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
}

/** A curl stub that, like `curl -o FILE`, writes whatever is being served to FILE. */
function withServingCurl() {
  const recorder = join(root, "recorder", "curl");
  writeStub(sb, recorder, "curl");
  const curl = [
    "#!/bin/bash",
    'prev=""',
    'for a in "$@"; do',
    `  if [ "$prev" = "-o" ] && [ -f '${join(root, "served")}' ]; then cp '${join(root, "served")}' "$a"; fi`,
    '  prev="$a"',
    "done",
    `exec '${recorder}' "$@"`,
    "",
  ].join("\n");
  writeFileSync(join(sb.bin, "curl"), curl, { mode: 0o755 });
}

/** What the next download returns: a file's bytes, or nothing at all. */
function serve(path: string | null) {
  const served = join(root, "served");
  rmSync(served, { force: true });
  if (path) copyFileSync(path, served);
}

function run(env: Record<string, string> = {}, extraEnv: Record<string, string> = {}) {
  return runStep(sb, lint, { ...PINNED, ...ON_LINUX_X64, ...env }, extraEnv);
}

/** Run with the expected hash pointed at the fake release, as if it were the real one. */
function runTrusting(extraEnv: Record<string, string> = {}) {
  return run({ ACTIONLINT_SHA256: release.sha256 }, extraEnv);
}

const progs = (r: ReturnType<typeof run>) => r.calls.map((c) => c.prog);

describe("run step: a tarball that matches the pinned hash", () => {
  it("downloads, verifies, extracts and runs actionlint, in that order", () => {
    const r = runTrusting();
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => [c.prog, ...c.argv])).toEqual([
      ["curl", "-fsSL", "--retry", "3", "--retry-connrefused", "-o", tarball, ASSET_URL],
      ["sha256sum", "-c"],
      ["tar", "-xzf", tarball, "-C", extracted, "actionlint"],
      ["actionlint"],
    ]);
    expect(r.stdout).toContain(`${tarball}: OK`);
  });

  it("runs actionlint from the workspace root with no arguments, so it lints .github/workflows", () => {
    const [call] = runTrusting().calls.filter((c) => c.prog === "actionlint");
    expect(call).toEqual({ prog: "actionlint", argv: [], cwd: sb.work, apiKeySet: false });
  });

  it("extracts only the actionlint binary", () => {
    expect(runTrusting().status).toBe(0);
    expect(readdirSync(extracted)).toEqual(["actionlint"]);
  });

  it("keeps the download and the binary out of the workspace", () => {
    const r = runTrusting();
    expect(r.created).toEqual([]);
    expect(existsSync(tarball)).toBe(true);
  });

  it("runs the binary it verified, not an actionlint that is already on PATH", () => {
    writeStub(sb, join(sb.bin, "actionlint"), "actionlint-on-path");
    const r = runTrusting();
    expect(r.status).toBe(0);
    expect(progs(r)).toContain("actionlint");
    expect(progs(r)).not.toContain("actionlint-on-path");
  });

  it.each([1, 2, 3])("exits with actionlint's exit code (%i)", (code) => {
    const r = runTrusting({ STUB_EXIT_ACTIONLINT: String(code) });
    expect(r.status).toBe(code);
    expect(progs(r).at(-1)).toBe("actionlint");
  });

  it("fails before running anything if the verified tarball has no actionlint in it", () => {
    release = fakeRelease(["LICENSE.txt", "README.md"]);
    serve(release.path);
    const r = runTrusting();
    expect(r.status).not.toBe(0);
    expect(progs(r)).toEqual(["curl", "sha256sum", "tar"]);
  });
});

describe("run step: a tarball that does not match the pinned hash", () => {
  function expectRejected(r: ReturnType<typeof run>) {
    expect(r.status).not.toBe(0);
    expect(progs(r)).toEqual(["curl", "sha256sum"]);
    expect(existsSync(extracted)).toBe(false);
    expect(r.created).toEqual([]);
  }

  it("fails against the real pinned hash, and nothing is extracted or run", () => {
    const r = run();
    expectRejected(r);
    expect(r.stdout).toContain(`${tarball}: FAILED`);
  });

  it("fails when a single byte of the expected tarball changes", () => {
    const tampered = join(root, "tampered.tar.gz");
    copyFileSync(release.path, tampered);
    appendFileSync(tampered, "\0");
    serve(tampered);
    expectRejected(runTrusting());
  });

  it.each([
    ["empty", () => ""],
    ["one character short", () => release.sha256.slice(0, 63)],
    ["all zeros", () => "0".repeat(64)],
    ["the linux_arm64 tarball's hash", () => checksums.get(`actionlint_${VERSION}_linux_arm64.tar.gz`) ?? ""],
    ["an md5-length value", () => release.sha256.slice(0, 32)],
  ])("fails when the expected hash is %s", (_label, hash) => {
    expectRejected(run({ ACTIONLINT_SHA256: hash() }));
  });

  it("fails when the download left no file", () => {
    serve(null);
    expectRejected(runTrusting());
  });
});

describe("run step: download failures", () => {
  it.each([6, 22, 56])("fails with curl's exit code (%i) and goes no further, even if a file was written", (code) => {
    const r = runTrusting({ STUB_EXIT_CURL: String(code) });
    expect(r.status).toBe(code);
    expect(progs(r)).toEqual(["curl"]);
    expect(existsSync(extracted)).toBe(false);
  });
});

describe("run step: missing shellcheck", () => {
  it("fails with an error before downloading anything", () => {
    rmSync(join(sb.bin, "shellcheck"));
    const r = runTrusting({ PATH: pathWithout(sb, ["shellcheck"]) });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.stdout).toMatch(/^::error::shellcheck is not on PATH/m);
  });

  it("is satisfied by any shellcheck on PATH", () => {
    const r = runTrusting({ PATH: pathWithout(sb, ["shellcheck"]) });
    expect(r.status).toBe(0);
    expect(progs(r)).toContain("actionlint");
  });
});

describe("run step: runner platform", () => {
  it.each([
    ["Linux", "ARM64"],
    ["Linux", "ARM"],
    ["Linux", "X86"],
    ["macOS", "X64"],
    ["macOS", "ARM64"],
    ["Windows", "X64"],
    ["linux", "x64"],
    ["", ""],
  ])("refuses %j %j with an error before downloading anything", (os, arch) => {
    const r = run({ RUNNER_OS: os, RUNNER_ARCH: arch, ACTIONLINT_SHA256: release.sha256 });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.stdout).toMatch(/^::error::The pinned actionlint build is linux_amd64, but this runner is /m);
    expect(r.stdout).toContain(`this runner is ${os} ${arch}.`);
  });
});
