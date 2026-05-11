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
