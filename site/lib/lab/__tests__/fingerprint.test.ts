import { describe, expect, it } from "vitest";
import { fingerprint } from "../fingerprint";

describe("fingerprint", () => {
  it("returns an fp:-prefixed 8-hex-digit string", () => {
    expect(fingerprint("")).toMatch(/^fp:[0-9a-f]{8}$/);
    expect(fingerprint("abc")).toMatch(/^fp:[0-9a-f]{8}$/);
  });

  it("is stable for the same input", () => {
    expect(fingerprint("abc")).toBe(fingerprint("abc"));
    expect(fingerprint("")).toBe(fingerprint(""));
  });

  it("differs for different inputs", () => {
    expect(fingerprint("abc")).not.toBe(fingerprint("abd"));
    expect(fingerprint("")).not.toBe(fingerprint(" "));
  });

  it("matches the FNV-1a 32-bit reference value", () => {
    // FNV-1a 32-bit offset basis for the empty string
    expect(fingerprint("")).toBe("fp:811c9dc5");
    // Known FNV-1a 32-bit value for "a"
    expect(fingerprint("a")).toBe("fp:e40c292c");
  });
});
