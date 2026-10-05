// Test harness for the shell steps in .github/workflows/*.yml and
// action/action.yml. It runs the real `run:` scripts from the YAML with
// bash, the way the Actions runner does, but with npm/npx/node and the
// eval CLI replaced by stubs that only record how they were called.

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface Step {
  name?: string;
  uses?: string;
  run?: string;
  shell?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  "working-directory"?: string;
}

export interface InputDecl {
  description?: string;
  required?: boolean;
  type?: string;
  default?: string | boolean | number;
}

// The YAML documents are untyped; tests assert on their shape directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Doc = any;

export function loadYaml(relPath: string): Doc {
  return parse(readFileSync(join(REPO_ROOT, relPath), "utf8"));
}

export function workflowFiles(): string[] {
  return readdirSync(join(REPO_ROOT, ".github", "workflows"))
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => `.github/workflows/${f}`);
}

/** Every step of every job in a workflow, or of a composite action. */
export function allSteps(doc: Doc): Step[] {
  if (doc.runs?.steps) return doc.runs.steps;
  return Object.values(doc.jobs ?? {}).flatMap((job: Doc) => job.steps ?? []);
}

export function stepNamed(steps: Step[], name: string): Step {
  const step = steps.find((s) => s.name === name);
  if (!step) throw new Error(`no step named "${name}"`);
  return step;
}

/**
 * Inputs as the runner would see them: declared defaults for anything not
 * passed, the passed value (even "") otherwise. Unknown inputs are an error,
 * as they are on GitHub.
 */
export function withDefaults(
  decls: Record<string, InputDecl>,
  given: Record<string, string>,
): Record<string, string> {
  for (const name of Object.keys(given)) {
    if (!(name in decls)) throw new Error(`undeclared input "${name}"`);
  }
  const out: Record<string, string> = {};
  for (const [name, decl] of Object.entries(decls)) {
    if (name in given) out[name] = given[name];
    else out[name] = decl.default === undefined ? "" : String(decl.default);
  }
  return out;
}

const WHOLE_EXPR = /^\$\{\{\s*(inputs|secrets)\.([A-Za-z0-9_-]+)\s*\}\}$/;

/**
 * Resolve a step's `env:` map. Only whole-value `${{ inputs.X }}` and
 * `${{ secrets.X }}` are supported; anything else throws, so a step can't
 * silently start depending on an expression these tests don't model.
 */
export function resolveEnv(
  env: Record<string, string> | undefined,
  ctx: { inputs: Record<string, string>; secrets?: Record<string, string> },
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    const raw = String(value);
    if (!raw.includes("${{")) {
      out[key] = raw;
      continue;
    }
    const m = WHOLE_EXPR.exec(raw);
    if (!m) throw new Error(`unsupported expression in env.${key}: ${raw}`);
    const scope = m[1] === "inputs" ? ctx.inputs : (ctx.secrets ?? {});
    out[key] = scope[m[2]] ?? "";
  }
  return out;
}

/** The bash flags the runner uses for a step. */
export function shellArgs(step: Step): string[] {
  if (step.shell === "bash") return ["--noprofile", "--norc", "-eo", "pipefail"];
  if (step.shell === undefined) return ["-e"];
  throw new Error(`unsupported shell "${step.shell}"`);
}

export interface Call {
  prog: string;
  argv: string[];
  cwd: string;
  apiKeySet: boolean;
}

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
  calls: Call[];
  /** Files created in the sandbox's working directory by the script. */
  created: string[];
}

export interface Sandbox {
  /** Working directory the step runs in (the job workspace). */
  work: string;
  /** Value of RUNNER_TEMP. */
  runnerTemp: string;
  bin: string;
  log: string;
}

export const STUB_PROGS = ["npm", "npx", "node"] as const;

export function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "wf-test-"));
  const sb: Sandbox = {
    work: join(root, "work"),
    runnerTemp: join(root, "runner-temp"),
    bin: join(root, "bin"),
    log: join(root, "log"),
  };
  for (const d of Object.values(sb)) mkdirSync(d, { recursive: true });
  for (const prog of STUB_PROGS) writeStub(sb, join(sb.bin, prog), prog);
  return sb;
}

/**
 * Write an executable stub that records its argv (NUL-separated, so values
 * with newlines survive), its cwd and whether the API key is in its
 * environment, then exits with $STUB_EXIT_<PROG> (default 0).
 */
export function writeStub(sb: Sandbox, path: string, prog: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const exitVar = `STUB_EXIT_${prog.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const script = [
    "#!/bin/bash",
    `log=${shQuote(sb.log)}`,
    'n=$(find "$log" -name "*.argv" | wc -l)',
    'n=$(printf "%04d" "$n")',
    // printf runs its format once even with no arguments, which would record
    // a single empty argument; write nothing for an empty argv instead.
    `if [ $# -gt 0 ]; then printf '%s\\0' "$@"; fi > "$log/$n.argv"`,
    `printf '%s\\n%s\\n%s\\n' ${shQuote(prog)} "$PWD" "\${ANTHROPIC_API_KEY:+set}" > "$log/$n.meta"`,
    `echo "stub ${prog} called"`,
    `exit "\${${exitVar}:-0}"`,
    "",
  ].join("\n");
  writeFileSync(path, script);
  chmodSync(path, 0o755);
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function readCalls(sb: Sandbox): Call[] {
  return readdirSync(sb.log)
    .filter((f) => f.endsWith(".argv"))
    .sort()
    .map((f) => {
      const raw = readFileSync(join(sb.log, f), "utf8");
      const argv = raw === "" ? [] : raw.slice(0, -1).split("\0");
      const [prog, cwd, key] = readFileSync(join(sb.log, f.replace(".argv", ".meta")), "utf8").split("\n");
      return { prog, argv, cwd, apiKeySet: key === "set" };
    });
}

/** Run one step's `run:` script in the sandbox with the given env. */
export function runStep(
  sb: Sandbox,
  step: Step,
  env: Record<string, string>,
  extraEnv: Record<string, string> = {},
): RunResult {
  if (!step.run) throw new Error(`step "${step.name}" has no run script`);
  const before = new Set(readdirSync(sb.work));
  const script = join(sb.runnerTemp, `step-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(script, step.run);
  const res = spawnSync("bash", [...shellArgs(step), script], {
    cwd: sb.work,
    encoding: "utf8",
    env: {
      PATH: `${sb.bin}:/usr/bin:/bin`,
      HOME: sb.work,
      RUNNER_TEMP: sb.runnerTemp,
      ...env,
      ...extraEnv,
    },
  });
  if (res.error) throw res.error;
  return {
    status: res.status ?? -1,
    stdout: res.stdout,
    stderr: res.stderr,
    calls: readCalls(sb),
    created: readdirSync(sb.work).filter((f) => !before.has(f)),
  };
}

export function fileExists(relPath: string): boolean {
  return existsSync(join(REPO_ROOT, relPath));
}

/**
 * Payloads that would run commands if a value were ever re-parsed by the
 * shell. Each one tries to create a file named PWNED* in the working dir.
 */
export const INJECTION_PAYLOADS: Record<string, string> = {
  "double-quote break": '"; touch PWNED1; echo "',
  "command substitution": "$(touch PWNED2)",
  backticks: "`touch PWNED3`",
  "single-quote break": "x' ; touch PWNED4 #",
  "newline then command": "x\ntouch PWNED5",
  "semicolon": "identity; touch PWNED6",
  "pipe": "identity | touch PWNED7",
  "variable and glob": 'a "b" \'c\' $HOME *',
};
