/**
 * Token-map auth for the multi-account worker.
 *
 * JOURNAL_TOKENS secret = JSON map { "<token>": "<accountId>" }.
 * Comparison strategy: SHA-256 both the incoming token and each map key,
 * then timingSafeEqual the two fixed 32-byte digests. Lengths always match,
 * so the runtime's throw-on-unequal-length can never fire, and no
 * length-dependent branch exists. We iterate EVERY map entry without early
 * exit and accumulate the match.
 */

const ACCOUNT_RE = /^[a-z0-9-]{1,32}$/;
const MIN_TOKEN_LENGTH = 8;

export interface TokenEntry {
  account: string;
  digest: ArrayBuffer;
}

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
}

// Cache keyed by the raw secret string: parse+digest once per isolate,
// not per request. A changed secret (new deploy) changes `raw` identity.
//
// We cache the in-flight PROMISE, not the resolved value: parsing awaits
// sha256() once per map entry, and concurrent requests in the same isolate
// interleave at those await points. If we published the cache key before
// the value existed, a second concurrent call could observe the key already
// set and return a still-empty result while the first call is still hashing
// — a spurious fail-closed 401 for a valid token. Caching the Promise means
// every concurrent caller with the same `raw` awaits the same parse.
const UNSET = Symbol('unset');
let cachedRaw: string | undefined | typeof UNSET = UNSET;
let cachedPromise: Promise<Map<string, TokenEntry> | null> | null = null;

async function doParse(raw: string | undefined): Promise<Map<string, TokenEntry> | null> {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('JOURNAL_TOKENS: malformed JSON — failing closed (all requests 401)');
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error('JOURNAL_TOKENS: not an object — failing closed');
    return null;
  }

  const map = new Map<string, TokenEntry>();
  for (const [token, account] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof account !== 'string' || !ACCOUNT_RE.test(account) || token.length < MIN_TOKEN_LENGTH) {
      console.error('JOURNAL_TOKENS: invalid entry — failing closed');
      return null;
    }
    map.set(token, { account, digest: await sha256(token) });
  }
  if (map.size === 0) return null;

  return map;
}

export async function parseTokenMap(
  raw: string | undefined,
): Promise<Map<string, TokenEntry> | null> {
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPromise = doParse(raw);
  }
  return cachedPromise!;
}

/** Returns the matched accountId, or null. Never throws on bad input. */
export async function verifyBearer(
  request: Request,
  tokensRaw: string | undefined,
): Promise<string | null> {
  const authHeader = request.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const incoming = authHeader.slice('Bearer '.length);
  if (incoming.length === 0) return null;

  const map = await parseTokenMap(tokensRaw);
  if (map === null) return null;

  const incomingDigest = await sha256(incoming);

  let matched: string | null = null;
  for (const entry of map.values()) {
    // 32-byte vs 32-byte — timingSafeEqual cannot throw here.
    const eq = crypto.subtle.timingSafeEqual(incomingDigest, entry.digest);
    if (eq && matched === null) matched = entry.account;
    // no break — every entry is compared on every request
  }
  return matched;
}
