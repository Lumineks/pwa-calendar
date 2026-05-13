import Dexie, { type Table } from 'dexie';
import { markDirty } from './sync.ts';

export interface Entry {
  date: string;
  body: string;
  updatedAt: string;
}

class JournalDatabase extends Dexie {
  entries!: Table<Entry, string>;

  constructor() {
    super('journal');
    this.version(1).stores({
      entries: 'date, updatedAt',
    });
  }
}

const db = new JournalDatabase();

export async function getEntry(date: string): Promise<Entry | undefined> {
  return db.entries.get(date);
}

export async function putEntry(date: string, body: string): Promise<Entry> {
  const entry: Entry = { date, body, updatedAt: new Date().toISOString() };
  await db.entries.put(entry);
  markDirty(date, 'put');
  return entry;
}

export async function deleteEntry(date: string): Promise<void> {
  await db.entries.delete(date);
  markDirty(date, 'delete');
}

export async function listEntries(from: string, to: string): Promise<Entry[]> {
  return db.entries.where('date').between(from, to, true, true).toArray();
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
  value: { body: string; updatedAt: string },
): Promise<void> {
  const entry: Entry = { date, body: value.body, updatedAt: value.updatedAt };
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
  await db.entries.delete(date);
}
