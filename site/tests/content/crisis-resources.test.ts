/**
 * "Text START to 678-678" is TrevorText, The Trevor Project's text line for LGBTQIA+ youth. Crisis Text Line
 * is a different service (text HOME to 741741). The site, the templates, the plugin and the eval-core registry
 * once labelled 678-678 "Crisis Text Line". These tests scan the shipped sources so the two can't be mixed up again.
 * Adapted from InclusiveCode/inclusive-ai's D44 R1 checks.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "../../..");
const SCOPE = ["site/app", "site/lib", "templates", "plugin", ".claude/commands", "core/eval-engine/src", "README.md", "hooks"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "__tests__", "tests", "test", ".git"]);
const LABELS = /(Crisis Text Line|TrevorText|Trevor Project|Trans Lifeline|\b988\b)/gi;
const SHORTCODE = /678[-‑– ]?678/g;

/** Source files under the given repo-relative paths, without tests or build output. */
function sourceFiles(paths: string[]): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    if (!existsSync(abs)) return;
    if (statSync(abs).isFile()) {
      if (!/\.(test|spec)\.[cm]?[jt]sx?$/.test(abs)) out.push(abs);
      return;
    }
    for (const name of readdirSync(abs)) if (!SKIP_DIRS.has(name)) walk(join(abs, name));
  };
  for (const p of paths) walk(join(REPO, p));
  return out.filter((f) => /\.(md|mdx|ts|tsx|js|mjs|cjs|json|ya?ml|txt|sh)$/.test(f) || !/\.\w+$/.test(f));
}

/** Each line of each file, as `path:line` plus its text. */
function lines(files: string[]) {
  return files.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .map((text, i) => ({ where: `${relative(REPO, f)}:${i + 1}`, text })),
  );
}

/** Every 678-678 mention with the resource name closest before it on the same line, and the clause after it. */
function shortcodeMentions(text: string) {
  return [...text.matchAll(SHORTCODE)].map((m) => {
    const labels = [...text.slice(0, m.index).matchAll(LABELS)];
    return {
      label: labels.length ? labels[labels.length - 1][1] : null,
      after: text.slice(m.index + m[0].length).split(/[).;,]/)[0],
    };
  });
}

describe("crisis resources are named correctly in shipped content", () => {
  const all = lines(sourceFiles(SCOPE));

  it("scans every path in scope", () => {
    for (const p of SCOPE) expect(existsSync(join(REPO, p)), p).toBe(true);
    expect(sourceFiles(SCOPE).length).toBeGreaterThan(40);
  });

  it("labels every 678-678 mention TrevorText", () => {
    const found: string[] = [];
    const bad: string[] = [];
    for (const { where, text } of all) {
      for (const m of shortcodeMentions(text)) {
        found.push(where);
        if (m.label?.toLowerCase() !== "trevortext" || /crisis text line/i.test(m.after)) {
          bad.push(`${where} [closest label: ${m.label}] ${text.trim().slice(0, 160)}`);
        }
      }
    }
    // Not vacuous: the site's checklist, registry and patterns, the template, the plugin, the audit command
    // and the eval-core registry all give the line.
    expect(found.length, found.join("\n")).toBeGreaterThanOrEqual(9);
    expect(found.some((w) => w.startsWith("site/"))).toBe(true);
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("never gives Crisis Text Line the 678-678 shortcode or the START keyword", () => {
    const bad = all
      .filter(({ text }) =>
        [...text.matchAll(/Crisis Text Line/gi)].some((m) =>
          /678[-‑– ]?678|\bSTART\b/.test(text.slice(m.index).split(/[).;]/)[0]),
        ),
      )
      .map(({ where, text }) => `${where} ${text.trim().slice(0, 160)}`);
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("gives Crisis Text Line its own number (text HOME to 741741) wherever it has one", () => {
    const withNumber = all.filter(({ text }) =>
      [...text.matchAll(/Crisis Text Line/gi)].some((m) => /\d{3}/.test(text.slice(m.index, m.index + 60))),
    );
    // Not vacuous: the crisis-resources pattern lists Crisis Text Line with its number.
    expect(withNumber.length).toBeGreaterThanOrEqual(1);
    const bad = withNumber
      .filter(({ text }) =>
        [...text.matchAll(/Crisis Text Line/gi)].some((m) => {
          const clause = text.slice(m.index, m.index + 60);
          return /\d{3}/.test(clause) && !/741741/.test(clause);
        }),
      )
      .map(({ where, text }) => `${where} ${text.trim().slice(0, 160)}`);
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
