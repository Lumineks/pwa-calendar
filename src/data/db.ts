import Dexie, { type Table } from 'dexie';
import { markDirty } from './sync.ts';
import { dbNameFor } from './namespace.ts';

export interface Entry {
  date: string;
  body: string;
  updatedAt: string;
  /**
   * Marks the body as rich text (HTML) rather than plain text. The ONLY
   * permitted value is 'html'; absence means plain text. Never sniff the body
   * for tags — the marker is the single source of truth.
   */
  format?: 'html';
}

class JournalDatabase extends Dexie {
  entries!: Table<Entry, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      entries: 'date, updatedAt',
    });
  }
}

/**
 * Lazy, namespace-keyed singleton. Route components call the accessors from
 * $effects that can run before App.svelte's init effect — Svelte effect
 * ordering is NOT guaranteed — so every accessor awaits a ready-latch that
 * resolves when initDb() is called. initDb is synchronous from the caller's
 * point of view and idempotent per namespace.
 */
let current: { ns: string; db: JournalDatabase } | null = null;
let resolveReady: ((db: JournalDatabase) => void) | null = null;
let ready: Promise<JournalDatabase> = new Promise((res) => {
  resolveReady = res;
});

export function initDb(ns: string): void {
  if (current?.ns === ns) return;
  if (current) {
    // Close the old handle so a late pull/push tail can't write into the
    // previous account's DB (cross-account leak guard).
    current.db.close();
    ready = new Promise((res) => {
      resolveReady = res;
    });
  }
  const db = new JournalDatabase(dbNameFor(ns));
  current = { ns, db };
  resolveReady?.(db);
  resolveReady = null;
}

export function closeDb(): void {
  if (!current) return;
  current.db.close();
  current = null;
  ready = new Promise((res) => {
    resolveReady = res;
  });
}

async function requireDb(): Promise<JournalDatabase> {
  return ready;
}

export async function getEntry(date: string): Promise<Entry | undefined> {
  const db = await requireDb();
  return db.entries.get(date);
}

export async function putEntry(
  date: string,
  body: string,
  format?: 'html',
): Promise<Entry> {
  const db = await requireDb();
  const entry: Entry = {
    date,
    body,
    updatedAt: new Date().toISOString(),
    ...(format ? { format } : {}),
  };
  await db.entries.put(entry);
  markDirty(date, 'put');
  return entry;
}

export async function deleteEntry(date: string): Promise<void> {
  const db = await requireDb();
  await db.entries.delete(date);
  markDirty(date, 'delete');
}

export async function listEntries(from: string, to: string): Promise<Entry[]> {
  const db = await requireDb();
  return db.entries.where('date').between(from, to, true, true).toArray();
}

export async function countEntries(): Promise<number> {
  const db = await requireDb();
  return db.entries.count();
}

/**
 * Write an entry that originated FROM THE SERVER into Dexie, preserving the
 * server's `updatedAt`.
 *
 * ‼  This is the ONLY place in the codebase that writes to Dexie without
 *    calling markDirty(). All user-originated writes MUST go through putEntry
 *    / deleteEntry above so the dirty set picks them up.
 *
 *    The reason this function exists at all: sync.pull() reconciles the
 *    server's view into the local DB via LWW. If those writes went through
 *    putEntry (which generates a new updatedAt and marks dirty), every pull
 *    would (a) bump updatedAt past the server's, then (b) push the same key
 *    right back — an infinite pull → write → markDirty → push → pull loop.
 *
 *    Treat this function like a back door: don't call it from UI code.
 */
export async function dbWriteFromServer(
  date: string,
  value: { body: string; updatedAt: string; format?: 'html' },
): Promise<void> {
  const db = await requireDb();
  const entry: Entry = {
    date,
    body: value.body,
    updatedAt: value.updatedAt,
    ...(value.format ? { format: value.format } : {}),
  };
  await db.entries.put(entry);
}

/**
 * Delete an entry that the server reports as gone, WITHOUT marking the date
 * dirty. Same back-door semantics as dbWriteFromServer.
 *
 * (Not used by v1 sync — see the comment in src/data/sync.ts about why we
 * don't auto-delete on absence — but kept here so the back door for deletes
 * is symmetric with the one for writes if a future phase needs it.)
 */
export async function dbDeleteFromServer(date: string): Promise<void> {
  const db = await requireDb();
  await db.entries.delete(date);
}
