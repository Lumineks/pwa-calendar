// Keep in sync with worker/src/limits.ts.
export const MAX_BODY_BYTES = 65536;

export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}
