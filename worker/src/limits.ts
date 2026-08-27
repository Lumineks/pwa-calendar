// Keep in sync with src/data/limits.ts (client). Self-imposed product limit;
// KV's own value ceiling is 25 MiB.
export const MAX_BODY_BYTES = 65536;

export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}
