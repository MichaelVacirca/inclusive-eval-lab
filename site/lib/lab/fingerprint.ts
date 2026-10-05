/**
 * Synchronous FNV-1a (32-bit) over UTF-16 code units.
 * This is a fingerprint for spotting identical text, not a cryptographic hash.
 */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return "fp:" + (hash >>> 0).toString(16).padStart(8, "0");
}
