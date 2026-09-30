// The in-browser database. It replaces the Postgres server: state lives in memory, is saved to
// localStorage after every successful change, and is seeded with sample data on first use.
import { createSeededDb, DB_VERSION } from './seed.js';

const KEY = 'shpc-procurement-demo-v1';
let db = null;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && saved.version === DB_VERSION) return saved;
    }
  } catch {
    /* storage unavailable or corrupt: fall back to fresh sample data */
  }
  return null;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* blocked or full: keep working from memory */
  }
}

export function getDb() {
  if (!db) {
    db = load();
    if (!db) {
      db = createSeededDb();
      persist();
    }
  }
  return db;
}

/** Run a change atomically: if anything throws, the database is restored exactly as it was. */
export function transact(fn) {
  const current = getDb();
  const backup = JSON.stringify(current);
  try {
    const result = fn(current);
    persist();
    return result;
  } catch (err) {
    db = JSON.parse(backup);
    throw err;
  }
}

/** Throw away all changes and load the sample data again. */
export function resetSampleData() {
  db = createSeededDb();
  persist();
}

// Another tab changed the data: pick it up
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) db = load();
  });
}
