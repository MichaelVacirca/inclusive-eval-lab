import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { POST } from "../../../app/api/lab/run/route";

const SITE = resolve(__dirname, "../../..");
const ROUTE_FILE = join(SITE, "app/api/lab/run/route.ts");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__") continue;
      out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe("POST /api/lab/run (stub)", () => {
  it("always returns 503 credentials_unavailable", async () => {
    const res = await POST();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({
      status: "credentials_unavailable",
      message: "Live mode is not configured on this deployment. This is not an evaluation result.",
    });
  });

  it("returns no environment-variable names", async () => {
    const text = await (await POST()).text();
    expect(text).not.toMatch(/API_KEY|apiKey|SECRET|TOKEN|process\.env/i);
    expect(text).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
  });

  it("reads no environment variables and never logs", () => {
    const src = readFileSync(ROUTE_FILE, "utf8");
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/console\./);
  });
});

describe("source hygiene for the lab library and route", () => {
  const files = [...sourceFiles(join(SITE, "lib/lab")), ...sourceFiles(join(SITE, "app/api/lab"))];

  it("finds the files it scans", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("has no console calls, browser storage, or raw HTML injection", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/console\./);
      expect(src, f).not.toMatch(/localStorage|sessionStorage/);
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML/);
      expect(src, f).not.toMatch(/process\.env/);
    }
  });
});
