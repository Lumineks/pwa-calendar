import { describe, it, expect } from 'vitest';
import { verifyBearer, parseTokenMap } from '../src/tokens';

const MAP = JSON.stringify({
  'marina-token-aaaaaaaaaaaaaaaaaaaaaaaa': 'marina-actress',
  'test-token-bb': 'test',
});

function req(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set('Authorization', auth);
  return new Request('https://x/health', { headers });
}

describe('parseTokenMap', () => {
  it('parses a valid map', async () => {
    const m = await parseTokenMap(MAP);
    expect(m).not.toBeNull();
    expect([...m!.values()].map((v) => v.account).sort()).toEqual(['marina-actress', 'test']);
  });
  it('fails closed on malformed JSON', async () => {
    expect(await parseTokenMap('{oops')).toBeNull();
  });
  it('fails closed on invalid accountId', async () => {
    expect(await parseTokenMap(JSON.stringify({ tok: 'Bad_Id!' }))).toBeNull();
  });
  it('fails closed on undefined', async () => {
    expect(await parseTokenMap(undefined)).toBeNull();
  });
  it('shares one in-flight parse across concurrent calls on a cold cache (no spurious null)', async () => {
    const FRESH_MAP = JSON.stringify({
      'concurrent-token-cccccccccccccccccccccc': 'concurrent-acct',
    });
    const [m1, m2] = await Promise.all([parseTokenMap(FRESH_MAP), parseTokenMap(FRESH_MAP)]);
    expect(m1).not.toBeNull();
    expect(m2).not.toBeNull();
  });
});

describe('verifyBearer', () => {
  it('maps marina token to her account', async () => {
    expect(await verifyBearer(req('Bearer marina-token-aaaaaaaaaaaaaaaaaaaaaaaa'), MAP)).toBe('marina-actress');
  });
  it('maps test token to test account', async () => {
    expect(await verifyBearer(req('Bearer test-token-bb'), MAP)).toBe('test');
  });
  it('rejects an unknown token (different length from every map key — must not throw)', async () => {
    expect(await verifyBearer(req('Bearer nope'), MAP)).toBeNull();
  });
  it('rejects same-length wrong token', async () => {
    expect(await verifyBearer(req('Bearer test-token-bc'), MAP)).toBeNull();
  });
  it('rejects missing/malformed header', async () => {
    expect(await verifyBearer(req(), MAP)).toBeNull();
    expect(await verifyBearer(req('Basic zzz'), MAP)).toBeNull();
  });
  it('rejects everything when the map is malformed (fail closed)', async () => {
    expect(await verifyBearer(req('Bearer test-token-bb'), '{broken')).toBeNull();
  });
});
