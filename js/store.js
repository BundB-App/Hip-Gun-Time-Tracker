// Lokaler Datenspeicher. Alle Datensätze tragen id + updatedAt;
// gelöschte bleiben als Tombstone (deleted: true) erhalten, damit der Sync sie weitergibt.

const DATA_KEY = 'ht.data';
const DIRTY_KEY = 'ht.dirty';
export const COLLECTIONS = ['clients', 'projects', 'entries'];

export function emptyDoc() {
  return { app: 'hip-gun-time-tracker', version: 1, clients: [], projects: [], entries: [] };
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function normalize(doc) {
  const out = emptyDoc();
  if (doc && typeof doc === 'object') {
    for (const c of COLLECTIONS) out[c] = Array.isArray(doc[c]) ? doc[c] : [];
  }
  return out;
}

// Führt zwei Dokumente zusammen: pro Datensatz gewinnt der neuere (updatedAt).
// changedRemote = true, wenn das Ergebnis etwas enthält, das in `remote` fehlt oder älter ist.
export function merge(local, remote) {
  const doc = emptyDoc();
  let changedRemote = false;
  for (const c of COLLECTIONS) {
    const map = new Map();
    for (const r of remote[c]) map.set(r.id, r);
    for (const l of local[c]) {
      const r = map.get(l.id);
      if (!r || (l.updatedAt || 0) > (r.updatedAt || 0)) {
        map.set(l.id, l);
        changedRemote = true;
      }
    }
    doc[c] = [...map.values()];
  }
  return { doc, changedRemote };
}

class Store {
  constructor() {
    this.doc = normalize(readJSON(DATA_KEY, null));
    this.dirty = readJSON(DIRTY_KEY, false);
    this.revision = 0; // zählt lokale Änderungen, damit der Sync parallele Edits erkennt
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  persist() {
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(this.doc));
      localStorage.setItem(DIRTY_KEY, JSON.stringify(this.dirty));
    } catch (err) {
      console.error('Speichern fehlgeschlagen', err);
    }
  }

  // ---- Lesen ----
  all(collection, { includeDeleted = false } = {}) {
    return includeDeleted ? this.doc[collection] : this.doc[collection].filter(r => !r.deleted);
  }

  get(collection, id) {
    return this.doc[collection].find(r => r.id === id && !r.deleted) || null;
  }

  clients({ includeArchived = false } = {}) {
    return this.all('clients')
      .filter(c => includeArchived || !c.archived)
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  projectsOf(clientId, { includeArchived = false } = {}) {
    return this.all('projects')
      .filter(p => p.clientId === clientId && (includeArchived || !p.archived))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  // ---- Schreiben ----
  upsert(collection, record) {
    const rec = { ...record, id: record.id || uid(), updatedAt: Date.now() };
    const list = this.doc[collection];
    const i = list.findIndex(r => r.id === rec.id);
    if (i >= 0) list[i] = { ...list[i], ...rec };
    else list.push(rec);
    this.markChanged();
    return rec;
  }

  remove(collection, id) {
    const rec = this.doc[collection].find(r => r.id === id);
    if (!rec) return;
    Object.assign(rec, { deleted: true, updatedAt: Date.now() });
    this.markChanged();
  }

  markChanged() {
    this.dirty = true;
    this.revision++;
    this.persist();
    this.emit();
  }

  // Ergebnis eines Syncs übernehmen. Lokale Änderungen, die während des Syncs
  // passiert sind, bleiben erhalten und markieren den Speicher weiter als dirty.
  applySynced(syncedDoc, revisionAtStart) {
    const { doc } = merge(this.doc, normalize(syncedDoc));
    this.doc = doc;
    this.dirty = this.revision !== revisionAtStart;
    this.persist();
    this.emit();
  }

  replaceAll(doc) {
    this.doc = normalize(doc);
    this.markChanged();
  }
}

export const store = new Store();
export { normalize };
