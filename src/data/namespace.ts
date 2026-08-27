/**
 * Local-state namespacing by token.
 *
 * FNV-1a 32-bit, synchronous, dependency-free. Deliberately NOT crypto:
 * this hash only discriminates known tokens on one device (Dexie DB name +
 * localStorage key prefix). The actual isolation boundary is the worker's
 * token map and per-account KV prefixes. crypto.subtle was rejected because
 * it is async and undefined in non-secure contexts (LAN-IP dev server).
 */
export function namespaceFor(token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function nsKey(ns: string, suffix: string): string {
  return `journal:${ns}:${suffix}`;
}

export function dbNameFor(ns: string): string {
  return `journal-${ns}`;
}
