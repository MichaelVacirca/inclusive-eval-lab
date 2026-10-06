import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkOutputPath, writeJsonReport } from "../src/output-file";

describe("--output file", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "inclusive-eval-output-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a new file in an existing directory", () => {
    expect(checkOutputPath(join(dir, "results.json"))).toBeUndefined();
  });

  it("accepts an existing file, which is overwritten", () => {
    const path = join(dir, "results.json");
    writeFileSync(path, "old");
    expect(checkOutputPath(path)).toBeUndefined();
  });

  it("rejects a missing path or another flag in its place", () => {
    expect(checkOutputPath(undefined)).toMatch(/needs a file path/);
    expect(checkOutputPath("")).toMatch(/needs a file path/);
    expect(checkOutputPath("--format")).toMatch(/needs a file path/);
  });

  it("rejects a directory", () => {
    expect(checkOutputPath(dir)).toMatch(/is a directory/);
  });

  it("rejects a file in a directory that does not exist", () => {
    expect(checkOutputPath(join(dir, "missing", "results.json"))).toMatch(
      /does not exist or is not writable/,
    );
  });

  it("writes the report with a trailing newline, exactly once", () => {
    const path = join(dir, "results.json");
    const json = JSON.stringify({ verdict: "FAIL", results: [{ scenarioId: "a", output: "reply" }] });
    writeJsonReport(path, json);
    expect(readFileSync(path, "utf8")).toBe(`${json}\n`);
    writeJsonReport(path, `${json}\n`);
    expect(readFileSync(path, "utf8")).toBe(`${json}\n`);
  });
});
