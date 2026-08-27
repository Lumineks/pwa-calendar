import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';

const MARINA = 'Bearer marina-token-aaaaaaaaaaaaaaaaaaaaaaaa';
const TEST = 'Bearer test-token-bb';

async function call(
  path: string,
  init: RequestInit = {},
  auth: string = TEST,
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set('Authorization', auth);
  if (init.body) headers.set('Content-Type', 'application/json');
  const req = new Request(`https://x${path}`, { ...init, headers });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('multi-account routes', () => {
  it('health returns the account of the token', async () => {
    const res = await call('/health', {}, MARINA);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, account: 'marina-actress' });
  });

  it('PUT stores under the account prefix and updates the account index', async () => {
    const put = await call('/entries/2026-08-01', {
      method: 'PUT',
      body: JSON.stringify({ body: 'привет', updatedAt: '2026-08-01T10:00:00.000Z' }),
    });
    expect(put.status).toBe(200);
    const raw = await env.JOURNAL.get('a:test:entries:2026-08-01');
    expect(raw).not.toBeNull();
    expect(await env.JOURNAL.get('entries:2026-08-01')).toBeNull(); // legacy untouched
    const index = JSON.parse((await env.JOURNAL.get('a:test:index')) ?? '[]');
    expect(index).toContain('2026-08-01');
  });

  it('accounts are isolated: marina cannot see test entries', async () => {
    await call('/entries/2026-08-02', {
      method: 'PUT',
      body: JSON.stringify({ body: 'секрет', updatedAt: '2026-08-02T10:00:00.000Z' }),
    });
    const get = await call('/entries/2026-08-02', {}, MARINA);
    expect(get.status).toBe(404);
    const list = await call('/entries', {}, MARINA);
    const data = (await list.json()) as { index: string[] };
    expect(data.index).not.toContain('2026-08-02');
  });

  it('format field round-trips; invalid format is 400', async () => {
    const ok = await call('/entries/2026-08-03', {
      method: 'PUT',
      body: JSON.stringify({ body: '<p>x</p>', updatedAt: '2026-08-03T10:00:00.000Z', format: 'html' }),
    });
    expect(ok.status).toBe(200);
    const got = await call('/entries/2026-08-03');
    expect(((await got.json()) as { format?: string }).format).toBe('html');
    const bad = await call('/entries/2026-08-04', {
      method: 'PUT',
      body: JSON.stringify({ body: 'x', updatedAt: '2026-08-04T10:00:00.000Z', format: 'md' }),
    });
    expect(bad.status).toBe(400);
  });

  it('LWW: older PUT gets 409 with server copy', async () => {
    await call('/entries/2026-08-05', {
      method: 'PUT',
      body: JSON.stringify({ body: 'new', updatedAt: '2026-08-05T12:00:00.000Z' }),
    });
    const stale = await call('/entries/2026-08-05', {
      method: 'PUT',
      body: JSON.stringify({ body: 'old', updatedAt: '2026-08-05T09:00:00.000Z' }),
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { server: { body: string } }).server.body).toBe('new');
  });

  it('413 on body over 65536 UTF-8 bytes (Cyrillic = 2 bytes/char)', async () => {
    const body = 'ы'.repeat(33000); // 66000 bytes > 65536, but only 33000 chars
    const res = await call('/entries/2026-08-06', {
      method: 'PUT',
      body: JSON.stringify({ body, updatedAt: '2026-08-06T10:00:00.000Z' }),
    });
    expect(res.status).toBe(413);
  });

  it('DELETE prunes the account index', async () => {
    await call('/entries/2026-08-07', {
      method: 'PUT',
      body: JSON.stringify({ body: 'x', updatedAt: '2026-08-07T10:00:00.000Z' }),
    });
    const del = await call('/entries/2026-08-07', { method: 'DELETE' });
    expect(del.status).toBe(204);
    const index = JSON.parse((await env.JOURNAL.get('a:test:index')) ?? '[]');
    expect(index).not.toContain('2026-08-07');
  });
});
