/**
 * app/opengraph-image.tsx must run on the default Node.js runtime.
 * Next.js 16.3 deprecates the Edge Runtime ("The Edge Runtime is deprecated" during `next build`).
 * These tests pin the route's exported metadata and render the image through `next/og`
 * to prove ImageResponse works there.
 */
import { describe, expect, it } from "vitest";
import * as og from "../../app/opengraph-image";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Reads width/height from a PNG's IHDR chunk. Throws on anything that is not a well-formed PNG header. */
function readPngSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24) throw new Error(`not a PNG: ${bytes.length} bytes is shorter than signature + IHDR`);
  PNG_SIGNATURE.forEach((b, i) => {
    if (bytes[i] !== b) throw new Error("not a PNG: bad signature");
  });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkType = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunkType !== "IHDR") throw new Error(`not a PNG: first chunk is ${JSON.stringify(chunkType)}, expected IHDR`);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("opengraph-image route segment config", () => {
  it("does not opt into the deprecated Edge Runtime", () => {
    const runtime = (og as Record<string, unknown>).runtime;
    expect(runtime).not.toBe("edge");
    expect(runtime).not.toBe("experimental-edge");
    expect([undefined, "nodejs"]).toContain(runtime);
  });

  it("exports the size Next.js uses for og:image:width/height (1200x630)", () => {
    expect(og.size).toEqual({ width: 1200, height: 630 });
    expect(Number.isInteger(og.size.width) && og.size.width > 0).toBe(true);
    expect(Number.isInteger(og.size.height) && og.size.height > 0).toBe(true);
  });

  it("exports image/png as og:image:type", () => {
    expect(og.contentType).toBe("image/png");
  });

  it("exports a non-empty alt text for og:image:alt", () => {
    expect(typeof og.alt).toBe("string");
    expect(og.alt.trim().length).toBeGreaterThan(0);
    expect(og.alt).toContain("InclusiveCode");
  });
});

describe("opengraph-image rendering on the Node.js runtime", () => {
  it("returns a 200 image/png Response whose PNG matches the exported size", { timeout: 30_000 }, async () => {
    const res = await og.default();
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(readPngSize(bytes)).toEqual(og.size);
    // A blank or truncated render is far smaller than the real artwork (about 66 kB).
    expect(bytes.length).toBeGreaterThan(10_000);
  });

  it("renders the same bytes on repeated calls (no request-time inputs)", { timeout: 30_000 }, async () => {
    const [a, b] = await Promise.all([og.default(), og.default()]);
    const [ba, bb] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
    expect(Buffer.from(ba).equals(Buffer.from(bb))).toBe(true);
  });
});

describe("readPngSize (test helper) failure modes", () => {
  it("rejects an empty buffer", () => {
    expect(() => readPngSize(new Uint8Array())).toThrow(/not a PNG/);
  });

  it("rejects non-PNG bytes of sufficient length", () => {
    expect(() => readPngSize(new TextEncoder().encode("<!doctype html><html><body>error</body></html>"))).toThrow(
      /bad signature/,
    );
  });

  it("rejects a PNG signature followed by a non-IHDR chunk", () => {
    const bytes = new Uint8Array(24);
    bytes.set(PNG_SIGNATURE, 0);
    bytes.set(new TextEncoder().encode("IDAT"), 12);
    expect(() => readPngSize(bytes)).toThrow(/expected IHDR/);
  });

  it("reads width and height from a minimal valid header", () => {
    const bytes = new Uint8Array(24);
    bytes.set(PNG_SIGNATURE, 0);
    bytes.set(new TextEncoder().encode("IHDR"), 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 1200);
    view.setUint32(20, 630);
    expect(readPngSize(bytes)).toEqual({ width: 1200, height: 630 });
  });
});
