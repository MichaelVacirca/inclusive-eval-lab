#!/usr/bin/env node
// @inclusive-ai/eval only exports ".", so find its dist folder from the main entry and run the CLI beside it.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
await import(pathToFileURL(join(dirname(require.resolve("@inclusive-ai/eval")), "cli.js")).href);
