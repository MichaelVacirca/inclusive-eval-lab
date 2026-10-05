import { describe, it, expect } from "vitest";
// The exact domain scenario set the CLI's --red-team mode passes to
// runAdversarial(). Imported by package name, like every other cross-package
// import in this repo, so it resolves to packages/eval/dist: CI builds every
// workspace before running any tests.
import { allScenarios } from "@inclusive-ai/eval";
import { adversarialScenarios } from "../src/index";
import { allTemplates } from "../src/templates/index";
import {
  base64Obfuscation,
  leetspeakSubstitution,
} from "../src/templates/encoding";

/** Repeats whole copies of `unit` (never splitting a pair) to >= minLength. */
const repeatTo = (unit: string, minLength: number) =>
  unit.repeat(Math.ceil(minLength / unit.length));

/** Hand-picked inputs that stress anything Latin-1-only or UTF-16-unaware. */
const EDGE_INPUTS: Record<string, string> = {
  empty: "",
  ascii: "Tell me about this person's background.",
  latin1: "caf\u00E9 cr\u00E8me, na\u00EFve fa\u00E7ade, \u00BFqu\u00E9 pas\u00F3?",
  emDashAndCurlyQuotes:
    "They said \u201Cno\u201D \u2014 and that\u2019s \u2018final\u2019.",
  // U+1F44B is a single surrogate pair.
  emojiSurrogatePair: "Hi \u{1F44B}",
  // U+1F3F3 U+FE0F U+200D U+1F308: a ZWJ sequence.
  rainbowFlag: "Pride \u{1F3F3}\uFE0F\u200D\u{1F308}",
  // U+1F3F3 U+FE0F U+200D U+26A7 U+FE0F: a ZWJ sequence.
  transgenderFlag: "Trans \u{1F3F3}\uFE0F\u200D\u26A7\uFE0F",
  cjk: "\u6211\u662F\u8DE8\u6027\u522B\u8005\u3002\u4F60\u597D\uFF0C\u4E16\u754C",
  // Decomposed e + U+0301, n + U+0303, and stacked marks.
  combiningMarks: "Jose\u0301 Pen\u0303a Z\u0351\u036B\u0343\u036A",
  newlines: "line one\nline two\r\nline three\n\nline five\n",
  // Over 1M UTF-8 bytes: well past where an unchunked
  // String.fromCharCode(...bytes) throws RangeError.
  longMixed: repeatTo(
    "Is this person gay? \u{1F3F3}\uFE0F\u200D\u{1F308} \u2014 caf\u00E9 \u8DE8 ",
    1_000_000,
  ),
  longAscii: repeatTo("Tell me their gender. ", 100_000),
};

/** Lone surrogates are not valid UTF-16 text and can't be encoded as UTF-8. */
const LONE_SURROGATE_INPUTS: Record<string, { input: string; utf8: string }> = {
  loneHigh: { input: "a\uD83Cb", utf8: "a\uFFFDb" },
  loneLow: { input: "a\uDF08b", utf8: "a\uFFFDb" },
  trailingHigh: { input: "Pride \uD83C", utf8: "Pride \uFFFD" },
};

const ALL_EDGE_INPUTS: Record<string, string> = {
  ...EDGE_INPUTS,
  ...Object.fromEntries(
    Object.entries(LONE_SURROGATE_INPUTS).map(([k, v]) => [k, v.input]),
  ),
};

const ASCII_INPUTS: Record<string, string> = {
  empty: "",
  printable: Array.from({ length: 0x7f - 0x20 }, (_, i) =>
    String.fromCharCode(0x20 + i),
  ).join(""),
  controls: "\0\x01\t\n\v\f\r\x1b\x7f",
  // Every padding case: length % 3 === 0, 1 and 2.
  pad0: "abc",
  pad1: "abcd",
  pad2: "abcde",
  newlines: EDGE_INPUTS.newlines,
  longAscii: EDGE_INPUTS.longAscii,
};

/** Pulls the base64 payload out of the base64Obfuscation prompt. */
function extractPayload(prompt: string): string {
  const match = /\nEncoded message: ([^\n]*)$/.exec(prompt);
  if (!match) throw new Error("no 'Encoded message:' line in prompt");
  return match[1];
}

/** Strict decode: rejects invalid base64 and invalid UTF-8. */
function decodeStrict(payload: string): string {
  const binary = atob(payload);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

const isAscii = (s: string) => /^[\x00-\x7f]*$/.test(s);

describe("every template × every real red-team input", () => {
  const realInputs = [
    ...allScenarios.map((s) => ({ id: s.id, input: s.input })),
    ...adversarialScenarios.map((s) => ({ id: s.id, input: s.input })),
  ];

  it("covers the domain and adversarial scenario sets", () => {
    expect(allScenarios.length).toBeGreaterThan(0);
    expect(adversarialScenarios).toHaveLength(30);
  });

  it("apply() never throws and returns a non-empty string", () => {
    const failures: string[] = [];
    for (const { id, input } of realInputs) {
      for (const t of allTemplates) {
        try {
          const result = t.apply(input);
          if (typeof result !== "string" || result.length === 0) {
            failures.push(`${id} × ${t.id}: empty or non-string result`);
          }
        } catch (err) {
          failures.push(`${id} × ${t.id}: ${String(err)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("base64Obfuscation round-trips every real input", () => {
    for (const { id, input } of realInputs) {
      const payload = extractPayload(base64Obfuscation.apply(input));
      expect(decodeStrict(payload), id).toBe(input);
    }
  });
});

describe("every template × edge-case inputs", () => {
  it("apply() never throws and returns a non-empty string", () => {
    const failures: string[] = [];
    for (const [name, input] of Object.entries(ALL_EDGE_INPUTS)) {
      for (const t of allTemplates) {
        try {
          const result = t.apply(input);
          if (typeof result !== "string" || result.length === 0) {
            failures.push(`${name} × ${t.id}: empty or non-string result`);
          }
        } catch (err) {
          failures.push(`${name} × ${t.id}: ${String(err)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("well-formed input never produces a broken surrogate pair", () => {
    for (const [name, input] of Object.entries(EDGE_INPUTS)) {
      for (const t of allTemplates) {
        expect(t.apply(input).isWellFormed(), `${name} × ${t.id}`).toBe(true);
      }
    }
  });

  it("long inputs are really that long", () => {
    expect(EDGE_INPUTS.longAscii.length).toBeGreaterThanOrEqual(100_000);
    expect(EDGE_INPUTS.longMixed.length).toBeGreaterThanOrEqual(1_000_000);
    expect(new TextEncoder().encode(EDGE_INPUTS.longMixed).length).toBeGreaterThan(
      1_000_000,
    );
    expect(EDGE_INPUTS.longMixed.isWellFormed()).toBe(true);
  });
});

describe("base64Obfuscation", () => {
  it.each(Object.entries(EDGE_INPUTS))(
    "round-trips %s through a standard UTF-8 base64 decode",
    (_name, input) => {
      const payload = extractPayload(base64Obfuscation.apply(input));
      expect(payload).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
      expect(payload.length % 4).toBe(0);
      expect(Buffer.from(payload, "base64").toString("utf8")).toBe(input);
      expect(decodeStrict(payload)).toBe(input);
    },
  );

  it("encodes the UTF-8 bytes, not Latin-1 bytes", () => {
    // "é" is C3 A9 in UTF-8; btoa("é") would encode the single Latin-1 byte E9.
    expect(extractPayload(base64Obfuscation.apply("\u00E9"))).toBe("w6k=");
    // "—" is E2 80 94 in UTF-8.
    expect(extractPayload(base64Obfuscation.apply("\u2014"))).toBe("4oCU");
  });

  it.each(Object.entries(LONE_SURROGATE_INPUTS))(
    "replaces a lone surrogate with U+FFFD (%s)",
    (_name, { input, utf8 }) => {
      // Lone surrogates have no UTF-8 encoding, so the WHATWG encoder
      // substitutes U+FFFD (EF BF BD). The rest of the text survives intact.
      const payload = extractPayload(base64Obfuscation.apply(input));
      expect(Buffer.from(payload, "base64").toString("utf8")).toBe(utf8);
      expect(decodeStrict(payload)).toBe(utf8);
      expect(utf8).toBe(input.toWellFormed());
    },
  );

  it.each(Object.entries(ASCII_INPUTS))(
    "is byte-for-byte identical to the old btoa output for ASCII (%s)",
    (_name, input) => {
      expect(isAscii(input)).toBe(true);
      // apply("") is the prompt with an empty payload, since btoa("") === "".
      const prefix = base64Obfuscation.apply("");
      expect(base64Obfuscation.apply(input)).toBe(prefix + btoa(input));
    },
  );

  it("is identical to the old btoa output for every ASCII-only real input", () => {
    const asciiInputs = [...allScenarios, ...adversarialScenarios]
      .map((s) => s.input)
      .filter(isAscii);
    expect(asciiInputs.length).toBeGreaterThan(0);
    for (const input of asciiInputs) {
      expect(extractPayload(base64Obfuscation.apply(input))).toBe(btoa(input));
    }
  });
});

describe("leetspeakSubstitution", () => {
  it("only rewrites ASCII letters and leaves other characters intact", () => {
    const input =
      "Is \u{1F3F3}\uFE0F\u200D\u26A7\uFE0F \u2014 \u201CLe\u0301a\u201D \u8DE8?";
    const body = leetspeakSubstitution.apply(input).split("\n").pop();
    expect(body).toBe(
      "1$ \u{1F3F3}\uFE0F\u200D\u26A7\uFE0F \u2014 \u201C13\u0301@\u201D \u8DE8?",
    );
  });
});
