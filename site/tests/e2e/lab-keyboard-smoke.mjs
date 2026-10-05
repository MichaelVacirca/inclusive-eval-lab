// Keyboard-only smoke test for /lab (independent verification; not run in CI).
//
// Usage:
//   cd site && npm run build && npx next start -p 3100 &
//   LAB_URL=http://localhost:3100/lab EVIDENCE_DIR=/path/to/screenshots node tests/e2e/lab-keyboard-smoke.mjs
//
// Requires Playwright 1.56.1 (global install is fine) and a Chromium in PLAYWRIGHT_BROWSERS_PATH.
// Every interaction uses the keyboard only (Tab, Shift+Tab, Space, Enter, arrows, Escape, typing).
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    const root = execSync("npm root -g").toString().trim();
    return require(join(root, "playwright"));
  }
}
const { chromium } = loadPlaywright();

const URL = process.env.LAB_URL ?? "http://localhost:3100/lab";
const EVIDENCE = process.env.EVIDENCE_DIR ?? "/tmp/lab-evidence";
mkdirSync(EVIDENCE, { recursive: true });

const results = [];
const observations = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
}
function observe(msg) {
  observations.push(msg);
  console.log(`NOTE  ${msg}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await context.newPage();

const pageErrors = [];
const consoleErrors = [];
const dialogs = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("dialog", async (d) => {
  dialogs.push(`${d.type()}: ${d.message()}`);
  await d.dismiss();
});

// ---------- helpers ----------
const focusLog = [];
async function focusInfo() {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { tag: "body" };
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type"),
      name: el.getAttribute("name"),
      value: el.value ?? null,
      id: el.id,
      text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
      checked: el.checked ?? null,
      focusVisible: el.matches(":focus-visible"),
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
    };
  });
}

/** Press Tab (or Shift+Tab) until the predicate holds for document.activeElement. */
async function tabUntil(desc, pred, arg, { back = false, max = 250 } = {}) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
    const hit = await page.evaluate(pred, arg);
    if (hit) {
      const info = await focusInfo();
      focusLog.push({ desc, ...info });
      return info;
    }
  }
  throw new Error(`Could not reach "${desc}" with ${back ? "Shift+Tab" : "Tab"}`);
}
const isButtonWithText = (t) => {
  const el = document.activeElement;
  return !!el && el.tagName === "BUTTON" && (el.textContent ?? "").includes(t);
};
const isLinkWithText = (t) => {
  const el = document.activeElement;
  return !!el && el.tagName === "A" && (el.textContent ?? "").includes(t);
};
const isRadio = (name) => {
  const el = document.activeElement;
  return !!el && el.tagName === "INPUT" && el.getAttribute("type") === "radio" && el.getAttribute("name") === name;
};
const isId = (id) => document.activeElement?.id === id;
const isSummary = (t) => {
  const el = document.activeElement;
  return !!el && el.tagName === "SUMMARY" && (el.textContent ?? "").includes(t);
};

const text = (sel) => page.locator(sel).first().innerText();
const headline = () => text("section[aria-labelledby=findings] p.text-xl");
const statusText = () => page.locator("[role=status]").first().innerText();
const compareText = () => page.locator("section[aria-labelledby=compare]").innerText();
async function waitStatus(n) {
  await page.waitForFunction((k) => (document.querySelector("[role=status]")?.textContent ?? "").includes(`Run ${k} complete`), n, {
    timeout: 30000,
  });
  return statusText();
}
function parseSummary(t) {
  const m = /(\d+) improved · (\d+) regressed · (\d+) unchanged · (\d+)\s+inconclusive/.exec(t);
  return m ? { improved: +m[1], regressed: +m[2], unchanged: +m[3], inconclusive: +m[4] } : null;
}
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(`${name} (step completed without exception)`, false, String(e).slice(0, 300));
  }
}

let runN = 0;
async function rerunViaKeyboard() {
  await tabUntil("Rerun button", isButtonWithText, "Rerun");
  await page.keyboard.press("Enter");
  runN += 1;
  return waitStatus(runN);
}

// ---------- 0. Load ----------
await step("load", async () => {
  const res = await page.goto(URL, { waitUntil: "networkidle" });
  check("REQ1 /lab returns 200 with no login", res?.status() === 200 && (await page.locator("input[type=password]").count()) === 0);
  const body = await page.locator("body").innerText();
  check("REQ1 demo banner 'Simulated demo — no AI model is called' visible", await page.getByText("Simulated demo — no AI model is called").isVisible());
  check("REQ1 'Fictional data' label visible", body.includes("Fictional data"));
  check("REQ1 responses labeled 'Simulated response'", (await page.getByText("Simulated response", { exact: true }).count()) === 2);
  check("REQ1 mode badge 'Simulated' shown, no live badge", body.includes("Simulated") && !body.includes("Live (unavailable)"));
  check("REQ14 limitations section present", body.includes("Limitations") && body.includes("single sample"));
  check("REQ14 'A pass means only that the displayed checks passed' shown", body.includes("A pass means only that the displayed checks passed"));
  const statusRegion = await page.evaluate(() => {
    const el = document.querySelector("[role=status]");
    return el ? { live: el.getAttribute("aria-live"), text: el.textContent } : null;
  });
  check("REQ13 polite status region exists before any run", statusRegion?.live === "polite" && statusRegion.text === "", JSON.stringify(statusRegion));
  const positiveTabindex = await page.evaluate(() => [...document.querySelectorAll("[tabindex]")].filter((e) => +e.getAttribute("tabindex") > 0).length);
  check("REQ13 no tabindex > 0", positiveTabindex === 0, String(positiveTabindex));
  await page.screenshot({ path: join(EVIDENCE, "01-initial-load.png") });
});

// ---------- 1. Choose a scenario (radio group, arrow keys) ----------
await step("choose scenario", async () => {
  const f = await tabUntil("scenario radio", isRadio, "scenario");
  check("REQ2 Tab reaches the checked scenario radio", f.checked === true && f.value === "spouse-parity", JSON.stringify(f));
  await page.keyboard.press("ArrowRight");
  const f2 = await focusInfo();
  const inspect2 = await page.locator("section[aria-labelledby=inspect]").innerText();
  check("REQ2 ArrowRight selects the second scenario", f2.value === "stated-identity" && f2.checked && inspect2.includes("they/them"), f2.value);
  await page.keyboard.press("ArrowRight");
  const inspect3 = await page.locator("section[aria-labelledby=inspect]").innerText();
  check("REQ3 third scenario is the HR disclosure boundary", inspect3.includes("Employee chat transcript") && inspect3.includes("because I'm trans"));
  await page.keyboard.press("ArrowRight"); // wraps to first
  const f4 = await focusInfo();
  check("REQ2 arrow keys wrap back to spouse scenario", f4.value === "spouse-parity" && f4.checked, f4.value);
});

// ---------- 2. Inspect paired inputs and responses ----------
await step("inspect", async () => {
  await tabUntil("step link 2", isLinkWithText, "2. Inspect", { back: true });
  await page.keyboard.press("Enter");
  check("REQ2 Shift+Tab + Enter on the in-page step link navigates to #inspect", (await page.evaluate(() => location.hash)) === "#inspect");
  const inspect = await page.locator("section[aria-labelledby=inspect]").innerText();
  check("REQ2/REQ14 Version A input (wife) and Version B input (husband) shown", inspect.includes("my wife, Jordan Lee") && inspect.includes("my husband, Jordan Lee"));
  const marks = await page.locator("section[aria-labelledby=inspect] mark").allInnerTexts();
  check("REQ4 variable highlighted in inputs", marks.includes("wife") && marks.includes("husband"), marks.slice(0, 6).join("|"));
  check(
    "REQ14 run metadata shown (provider, model, fingerprint, created at)",
    ["Provider", "lab-simulator-rules-v1", "Instruction fingerprint", "Created at", "Temperature"].every((s) => inspect.includes(s)),
  );
  check("REQ2 baseline responses shown (B asks for marriage certificate)", inspect.includes("marriage certificate"));
});

// ---------- 3. Review findings ----------
await step("findings", async () => {
  const hl = await headline();
  check("REQ2 baseline headline is 'Checks failed'", hl === "Checks failed", hl);
  await tabUntil("first Rubric summary", isSummary, "Rubric");
  await page.keyboard.press("Enter");
  const open = await page.evaluate(() => document.activeElement?.parentElement?.hasAttribute("open"));
  const rubric = await page.evaluate(() => document.activeElement?.parentElement?.innerText ?? "");
  check("REQ2 Enter opens the rubric <details>", open === true);
  check("REQ2/REQ14 rubric shows criterion, method, lexicon, limitations", ["Criterion", "Method", "Lexicon", "Limitations"].every((s) => rubric.includes(s)));
  await page.keyboard.press("Space");
  const closed = await page.evaluate(() => !document.activeElement?.parentElement?.hasAttribute("open"));
  check("REQ13 Space toggles the rubric closed", closed === true);
  const findings = await page.locator("section[aria-labelledby=findings]").innerText();
  check("REQ2 findings cite excerpts with character offsets", /Version B, characters \d+–\d+/.test(findings));
  check("REQ3 system-introduced relabeling is flagged", findings.includes("system introduced (not the user's word)"));
  check("REQ3 user's own term tagged user provided", findings.includes("user provided (the user's own word)"));
  check("REQ10 automated and after-review counts shown separately", findings.includes("Automated") && findings.includes("After human review"));
});

// ---------- 4. Disagree with an automated judgment ----------
await step("override", async () => {
  await tabUntil("first Disagree button", isButtonWithText, "Disagree with this result");
  await page.keyboard.press("Enter");
  let f = await focusInfo();
  check("REQ2 Enter opens the override form and focuses the first verdict radio", f.tag === "input" && f.type === "radio" && f.value === "pass", JSON.stringify(f));
  await page.keyboard.press("Escape");
  f = await focusInfo();
  const formCount = await page.locator("section[aria-labelledby=findings] form").count();
  check("REQ13 Escape closes the form and returns focus to the trigger", formCount === 0 && f.text.includes("Disagree"), JSON.stringify(f));
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space"); // check "Pass"
  f = await focusInfo();
  check("REQ2 Space selects the human verdict", f.value === "pass" && f.checked === true);
  await page.keyboard.press("Tab"); // -> reason
  f = await focusInfo();
  check("REQ13 Tab moves from verdict to reason textarea", f.tag === "textarea", f.tag);
  await page.keyboard.press("Tab"); // -> Save
  await page.keyboard.press("Enter"); // save with empty reason
  const err = await page.locator("section[aria-labelledby=findings] form [role=alert]").innerText().catch(() => "");
  check("REQ10/REQ13 saving without a reason shows an error alert", err.includes("reason is required"), err);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("Both requests are standard identity checks <b>in my view</b>.");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  f = await focusInfo();
  check("REQ13 after saving, focus returns to the Disagree button", f.text.includes("Disagree"), JSON.stringify(f));
  const findings = await page.locator("section[aria-labelledby=findings]").innerText();
  check("REQ10 both human and automated verdicts shown", findings.includes("Human review: Pass — automated result: Fail"));
  const firstRow = await page.locator("section[aria-labelledby=findings] ol > li").first().innerText();
  check("REQ10 the automated badge for the row still reads Fail", /✗\s*Fail/.test(firstRow), firstRow.slice(0, 120));
  check("REQ10 headline unchanged by the override", (await headline()) === "Checks failed");
  const counts = await page.locator("section[aria-labelledby=findings] .grid h3").allInnerTexts();
  const autoBox = await page.locator("section[aria-labelledby=findings] .grid > div").nth(0).innerText();
  const reviewBox = await page.locator("section[aria-labelledby=findings] .grid > div").nth(1).innerText();
  check("REQ10 automated vs after-review counts differ after override", autoBox.replace("Automated", "") !== reviewBox.replace("After human review", ""), `${counts} | ${autoBox} | ${reviewBox}`.replace(/\n/g, " "));
  const log = await page.locator("section[aria-labelledby=review-log]").innerText();
  check("REQ10 review log records human and automated verdicts and the reason", log.includes("human Pass") && log.includes("automated Fail") && log.includes("<b>in my view</b>"));
  check("REQ11 HTML in the reason renders as text", (await page.locator("section[aria-labelledby=review-log] b").count()) === 0);
  await page.screenshot({ path: join(EVIDENCE, "02-override-human-vs-automated.png"), fullPage: false });
});

// ---------- 5. Edit the instruction (presets) and rerun ----------
await step("edit and rerun", async () => {
  const before = await page.locator("#lab-instruction").inputValue();
  await tabUntil("FIX-VERIFY preset", isButtonWithText, "FIX-VERIFY");
  await page.keyboard.press("Enter");
  await tabUntil("FIX-TERMS preset", isButtonWithText, "FIX-TERMS");
  await page.keyboard.press("Enter");
  const after = await page.locator("#lab-instruction").inputValue();
  check("REQ2 presets append documented snippets to the instruction", after.startsWith(before) && after.includes("Apply identical verification") && after.includes("exact relationship terms"));
  const st = await rerunViaKeyboard();
  check("REQ13 status region announces run completion", st.startsWith("Run 1 complete"), st);
  const used = await page.locator("section[aria-labelledby=inspect]").innerText();
  check("REQ5 the run used the edited instruction (shown under 'Instruction used')", used.includes("Apply identical verification requirements") && used.includes("Refer to people using the exact relationship terms"));
  check("REQ2 fixed instruction: headline is all-pass", (await headline()) === "All displayed checks passed");
  const cmp = parseSummary(await compareText());
  check("REQ2 compare shows improvements and no regressions", !!cmp && cmp.improved > 0 && cmp.regressed === 0, JSON.stringify(cmp));
  const caption = await page.locator("section[aria-labelledby=compare] table caption").count();
  check("REQ14 comparison is a captioned table", caption === 1);

  // Over-correction preset -> regression.
  await tabUntil("OVER-NEUTRAL preset", isButtonWithText, "OVER-NEUTRAL", { back: true });
  await page.keyboard.press("Enter");
  const st2 = await rerunViaKeyboard();
  const cmp2 = parseSummary(await compareText());
  check("REQ2 OVER-NEUTRAL produces a regression", !!cmp2 && cmp2.regressed > 0, `${st2} ${JSON.stringify(cmp2)}`);

  // Switch the shown run with arrow keys.
  await tabUntil("show-run radio", isRadio, "view-run", { back: true });
  await page.keyboard.press("ArrowLeft");
  const hlBase = await headline();
  const f = await page.locator("section[aria-labelledby=findings]").innerText();
  check("REQ10 baseline view still shows the earlier override alongside the automated result", hlBase === "Checks failed" && f.includes("Human review: Pass — automated result: Fail"), hlBase);
  await page.keyboard.press("ArrowRight");
  const fl = await focusInfo();
  const usedLatest = await page.locator("section[aria-labelledby=inspect]").innerText();
  check(
    "REQ2 arrow keys switch back to the latest run",
    fl.value === "latest" && fl.checked === true && usedLatest.includes("Always use gender-neutral terms for family members"),
    JSON.stringify(fl),
  );
});

// ---------- 6. Inert HTML in the instruction ----------
await step("xss", async () => {
  await tabUntil("instruction textarea", isId, "lab-instruction");
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n<img src=x onerror=alert(1)>");
  const st = await rerunViaKeyboard();
  await page.waitForTimeout(500);
  const used = await page.locator("section[aria-labelledby=inspect] p.whitespace-pre-wrap").first().innerText();
  check("REQ11 typed <img onerror> shows as literal text under 'Instruction used'", used.includes("<img src=x onerror=alert(1)>"), st);
  check("REQ11 no <img src=x> element created", (await page.locator('img[src="x"]').count()) === 0);
  check("REQ11 no dialog fired", dialogs.length === 0, dialogs.join("; "));
});

// ---------- 7. Fault injection ----------
await step("fault injection", async () => {
  await tabUntil("Reset button", isButtonWithText, "Reset to the baseline instruction", { back: true });
  await page.keyboard.press("Enter");
  check("REQ2 Reset restores the baseline instruction", (await page.locator("#lab-instruction").inputValue()).startsWith("You are the customer support assistant") && !(await page.locator("#lab-instruction").inputValue()).includes("onerror"));
  await tabUntil("FIX-VERIFY preset", isButtonWithText, "FIX-VERIFY", { back: true });
  await page.keyboard.press("Enter");
  await tabUntil("FIX-TERMS preset", isButtonWithText, "FIX-TERMS");
  await page.keyboard.press("Enter");
  await rerunViaKeyboard();
  check("REQ9 control: fixed instruction without faults is all-pass", (await headline()) === "All displayed checks passed");

  const expected = [
    ["model_error", "Model error — not evaluated"],
    ["timeout", "Timed out — not evaluated"],
    ["credentials_unavailable", "Credentials unavailable — not evaluated"],
    ["malformed_result", "Evaluator error (malformed) — not evaluated"],
  ];
  for (const [kind, label] of expected) {
    await tabUntil("fault select", isId, "lab-fault", { back: true });
    await page.keyboard.press("ArrowDown");
    const v = await page.locator("#lab-fault").inputValue();
    const st = await rerunViaKeyboard();
    const hl = await headline();
    const body = await page.locator("section[aria-labelledby=inspect]").innerText();
    const fnd = await page.locator("section[aria-labelledby=findings]").innerText();
    check(`REQ8 fault ${kind} selected by keyboard`, v === kind, v);
    check(`REQ8/REQ9 fault ${kind} shows '${label}'`, body.includes(label) || fnd.includes(label));
    check(`REQ9 fault ${kind}: headline is not a pass`, hl !== "All displayed checks passed" && /not a pass|incomplete/i.test(hl), hl);
    check(`REQ9 fault ${kind}: announcement is not a pass`, !st.includes("All displayed checks passed"), st);
    const disabled = await page.locator("section[aria-labelledby=findings] button:disabled", { hasText: "Disagree" }).count();
    check(`REQ10 fault ${kind}: override disabled for not-evaluated/error rows`, disabled > 0, String(disabled));
    if (kind === "timeout") await page.screenshot({ path: join(EVIDENCE, "03-fault-timeout-not-evaluated.png") });
  }
  await tabUntil("fault select", isId, "lab-fault", { back: true });
  await page.keyboard.press("Home");
  check("REQ13 Home key resets the fault select to None", (await page.locator("#lab-fault").inputValue()) === "none");
});

// ---------- 8. Live mode -> unavailable; incompatible comparison refused ----------
await step("live mode", async () => {
  await tabUntil("response source radio", isRadio, "response-source", { back: true });
  await page.keyboard.press("ArrowDown");
  const f = await focusInfo();
  check("REQ2 ArrowDown selects Live", f.value === "live" && f.checked === true, JSON.stringify(f));
  const st = await rerunViaKeyboard();
  const alert = await page.locator("[role=alert]").first().innerText().catch(() => "");
  check("REQ13 live run shows an error alert", alert.includes("Live mode unavailable on this deployment — this is not an evaluation result."), alert);
  const inspect = await page.locator("section[aria-labelledby=inspect]").innerText();
  check("REQ8 live: both versions show 'Credentials unavailable — not evaluated'", (inspect.match(/Credentials unavailable — not evaluated/g) ?? []).length >= 2);
  check("REQ1 live run labeled 'Live (unavailable)' and not 'Simulated response'", inspect.includes("Live (unavailable)") && !inspect.includes("Simulated response"));
  check("REQ9 live: headline is not a pass", (await headline()) !== "All displayed checks passed", await headline());
  const cmp = await compareText();
  check("REQ6 simulated baseline vs live run is refused", cmp.includes("Not comparable: mode differs") && parseSummary(cmp) === null, cmp.slice(0, 160));
  check("REQ13 status announces live completion", st.includes("complete"), st);
  await page.locator("section[aria-labelledby=compare]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(EVIDENCE, "04-live-unavailable-comparison-refused.png") });

  // Loading state during a slow live response.
  await page.route("**/api/lab/run", async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      await route.continue();
    } catch {}
  });
  await tabUntil("Rerun button", isButtonWithText, "Rerun", { back: true });
  await page.keyboard.press("Enter");
  runN += 1;
  await page.waitForTimeout(600);
  const loading = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Rerun");
    const busy = document.querySelector("[aria-busy=true]");
    const st = document.querySelector("[role=status]")?.textContent ?? "";
    return { disabled: btn?.disabled ?? null, busy: !!busy, status: st, bodyHasRunning: /running|loading/i.test(document.body.innerText) };
  });
  check(
    "REQ13 a loading state is shown while a live run is in flight",
    loading.disabled || loading.busy || /running|loading/i.test(loading.status) || loading.bodyHasRunning,
    JSON.stringify(loading),
  );
  await waitStatus(runN);
  await page.unroute("**/api/lab/run");

  // Network failure -> model error (distinct from credentials).
  await page.route("**/api/lab/run", (route) => route.abort("failed"));
  await page.keyboard.press("Enter");
  runN += 1;
  await waitStatus(runN);
  const inspect2 = await page.locator("section[aria-labelledby=inspect]").innerText();
  check("REQ8 live network failure shows 'Model error — not evaluated'", inspect2.includes("Model error — not evaluated"));
  await page.unroute("**/api/lab/run");

  // Timeout -> timed out (live responder aborts after 15 s).
  await page.route("**/api/lab/run", async (route) => {
    await new Promise((r) => setTimeout(r, 17000));
    try {
      await route.continue();
    } catch {}
  });
  await page.keyboard.press("Enter");
  runN += 1;
  await waitStatus(runN);
  const inspect3 = await page.locator("section[aria-labelledby=inspect]").innerText();
  check("REQ8 live timeout shows 'Timed out — not evaluated'", inspect3.includes("Timed out — not evaluated"));
  const alert3 = await page.locator("[role=alert]").first().innerText().catch(() => "");
  if (alert3.includes("Live mode unavailable")) observe(`After a live TIMEOUT the alert still reads: "${alert3}"`);
  await page.unroute("**/api/lab/run");
});

// ---------- 9. Download review log ----------
await step("download log", async () => {
  await tabUntil("Download review log", isButtonWithText, "Download review log");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 5000 }), page.keyboard.press("Enter")]);
  const p = await dl.path();
  const json = JSON.parse(readFileSync(p, "utf8"));
  const o = json.overrides?.[0];
  check("REQ10 downloaded log keeps human and automated verdicts separate", o?.automatedStatus === "fail" && o?.humanStatus === "pass", JSON.stringify(o));
});

// ---------- focus visibility ----------
const notVisible = focusLog.filter((f) => f.tag !== "body" && (!f.focusVisible || f.outlineStyle === "none" || f.outlineWidth === "0px"));
check(
  `REQ13 visible focus outline on every keyboard-focused control (${focusLog.length} sampled)`,
  notVisible.length === 0,
  notVisible.map((f) => `${f.desc}:${f.tag}:${f.outlineStyle}/${f.outlineWidth}`).join(", "),
);
const kinds = [...new Set(focusLog.map((f) => `${f.tag}${f.type ? `[${f.type}]` : ""}`))];
observe(`Focused control kinds sampled: ${kinds.join(", ")}`);

// ---------- errors ----------
const resourceErrors = consoleErrors.filter((m) => /Failed to load resource|net::ERR_/i.test(m));
const jsConsoleErrors = consoleErrors.filter((m) => !resourceErrors.includes(m));
check("REQ13 no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
check("REQ13 no JS console errors (network 503/aborts excluded)", jsConsoleErrors.length === 0, jsConsoleErrors.join(" | "));
observe(`Network console errors (expected from 503 stub / injected aborts): ${resourceErrors.length}`);
check("REQ11 no dialogs during the whole session", dialogs.length === 0, dialogs.join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} checks passed; ${failed.length} failed.`);
for (const f of failed) console.log(`  FAILED: ${f.name}  [${f.detail}]`);
for (const o of observations) console.log(`  NOTE: ${o}`);
process.exit(failed.length > 0 ? 1 : 0);
