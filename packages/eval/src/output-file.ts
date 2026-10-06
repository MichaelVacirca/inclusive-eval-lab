import { accessSync, constants, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Checks that `--output <path>` can be written, so a bad path fails before any
 * API call instead of after a full run. Returns an error message, or undefined.
 */
export function checkOutputPath(path: string | undefined): string | undefined {
  if (!path || path.startsWith("--")) {
    return "--output needs a file path, e.g. --output results.json";
  }
  const full = resolve(path);
  try {
    if (statSync(full).isDirectory()) {
      return `--output ${path} is a directory, not a file`;
    }
  } catch {
    // The file does not exist yet, which is fine.
  }
  try {
    accessSync(dirname(full), constants.W_OK);
  } catch {
    return `--output directory ${dirname(full)} does not exist or is not writable`;
  }
  return undefined;
}

/** Writes a JSON report to `path`, ending with a newline. */
export function writeJsonReport(path: string, json: string): void {
  writeFileSync(path, json.endsWith("\n") ? json : `${json}\n`);
}
