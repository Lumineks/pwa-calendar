#!/usr/bin/env node
/**
 * One-shot account migration: legacy keys -> a:marina-actress:* (copy, never move).
 * Legacy keys are a permanent archive. Every mode is idempotent.
 * Report-only by default; --apply performs writes. --env dev rehearses on the
 * dev namespace (wrangler env dev), otherwise production --remote.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ACCOUNT = 'marina-actress';
const mode = process.argv[2];
const APPLY = process.argv.includes('--apply');
const DEV = process.argv.includes('--env') && process.argv[process.argv.indexOf('--env') + 1] === 'dev';

const envArgs = DEV ? ['--env', 'dev'] : ['--remote'];

function wrangler(args) {
  return execFileSync('npx', ['wrangler', 'kv', 'key', ...args, '--binding=JOURNAL', ...envArgs], {
    cwd: new URL('..', import.meta.url).pathname,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function listAllKeys() {
  // wrangler paginates internally and returns the full JSON array, but we
  // guard anyway: parse, and if the output ever gains a cursor envelope, fail loudly.
  const out = wrangler(['list']);
  const parsed = JSON.parse(out);
  if (!Array.isArray(parsed)) throw new Error('unexpected list output — update script for pagination');
  return parsed.map((k) => k.name);
}

const getValue = (key) => wrangler(['get', key]);
const putValue = (key, value) => wrangler(['put', key, value]);

function legacyIndex() {
  try { return JSON.parse(getValue('index')); } catch { return []; }
}
function accountIndex() {
  try { return JSON.parse(getValue(`a:${ACCOUNT}:index`)); } catch { return []; }
}
const upd = (raw) => { try { return JSON.parse(raw).updatedAt ?? ''; } catch { return ''; } };

async function retryGet(key, attempts = 4, delayMs = 5000) {
  for (let i = 0; i < attempts; i++) {
    try { return getValue(key); } catch (e) {
      if (i === attempts - 1) throw e;
      console.log(`  retry ${key} in ${delayMs}ms (KV eventual consistency)`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

if (mode === 'backup') {
  const keys = listAllKeys();
  const dump = {};
  for (const k of keys) dump[k] = getValue(k);
  const dir = join(homedir(), 'journal-kv-backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `kv-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(dump, null, 2));
  console.log(`Backed up ${keys.length} keys to ${file}`);
  console.log('>>> Copy this file to a second safe location NOW, before proceeding.');
} else if (mode === 'copy') {
  const idx = legacyIndex();
  const listed = listAllKeys().filter((k) => k.startsWith('entries:')).map((k) => k.slice('entries:'.length));
  const dates = [...new Set([...idx, ...listed])].sort();
  if (idx.length !== listed.length) {
    console.warn(`WARNING: legacy index has ${idx.length} dates, list() found ${listed.length} entry keys — union used (${dates.length}).`);
  }
  console.log(`${APPLY ? 'Copying' : 'Would copy'} ${dates.length} entries -> a:${ACCOUNT}:*`);
  for (const d of dates) {
    const v = getValue(`entries:${d}`);
    if (APPLY) putValue(`a:${ACCOUNT}:entries:${d}`, v);
    console.log(`  ${d}`);
  }
  const merged = [...new Set([...accountIndex(), ...dates])].sort();
  if (APPLY) putValue(`a:${ACCOUNT}:index`, JSON.stringify(merged));
  console.log(`${APPLY ? 'Wrote' : 'Would write'} merged index (${merged.length} dates).`);
} else if (mode === 'verify') {
  const idx = legacyIndex();
  const listed = listAllKeys().filter((k) => k.startsWith('entries:')).map((k) => k.slice('entries:'.length));
  const expected = [...new Set([...idx, ...listed])].sort();
  let ok = 0;
  const bad = [];
  for (const d of expected) {
    const src = getValue(`entries:${d}`);
    const dst = await retryGet(`a:${ACCOUNT}:entries:${d}`);
    if (src === dst) ok++;
    else bad.push(d);
  }
  const dstIdx = accountIndex();
  const idxOk = expected.every((d) => dstIdx.includes(d));
  console.log(`Verified ${ok}/${expected.length} entries byte-identical. Index covers all: ${idxOk}.`);
  if (bad.length || !idxOk) {
    console.error('MISMATCH:', bad);
    process.exit(1);
  }
  console.log(`ASSERT: index(${idx.length}) list(${listed.length}) union(${expected.length}) verified(${ok}) — all consistent.`);
} else if (mode === 'diff' || mode === 'reverse') {
  const fwd = mode === 'diff';
  const idx = legacyIndex();
  const dstIdx = accountIndex();
  const dates = [...new Set([...idx, ...dstIdx])].sort();
  let pending = 0;
  for (const d of dates) {
    let src = null; let dst = null;
    try { src = getValue(fwd ? `entries:${d}` : `a:${ACCOUNT}:entries:${d}`); } catch { /* absent */ }
    try { dst = getValue(fwd ? `a:${ACCOUNT}:entries:${d}` : `entries:${d}`); } catch { /* absent */ }
    if (src === null) continue;
    if (dst !== null && upd(dst) > upd(src)) {
      if (fwd) {
        console.error(`HARD STOP: destination a:${ACCOUNT}:entries:${d} is NEWER than legacy — direction assumption wrong. No writes performed.`);
        process.exit(1);
      }
      continue; // reverse mode: legacy newer -> nothing to do
    }
    if (dst === null || upd(src) > upd(dst)) {
      pending++;
      console.log(`  ${APPLY ? 'copying' : 'would copy'} ${d} (${upd(src)} > ${dst === null ? 'absent' : upd(dst)})`);
      if (APPLY) {
        putValue(fwd ? `a:${ACCOUNT}:entries:${d}` : `entries:${d}`, src);
        if (fwd) {
          const merged = [...new Set([...accountIndex(), d])].sort();
          putValue(`a:${ACCOUNT}:index`, JSON.stringify(merged));
        }
      }
    }
  }
  console.log(`${mode}: ${pending} entries ${APPLY ? 'copied' : 'pending (run with --apply)'}.`);
} else {
  console.log('Usage: node scripts/migrate-accounts.mjs <backup|copy|verify|diff|reverse> [--apply] [--env dev]');
  process.exit(2);
}
