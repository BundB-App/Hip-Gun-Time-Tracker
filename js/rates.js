// Tagessätze und Betragsberechnung.
// - Voreinstellung (Einstellungen) gilt nur für neu angelegte Kunden und Projekte.
// - Kunde und Projekt tragen ihren eigenen Preis (rates), der beim Anlegen festgeschrieben wird.
// - Jeder Eintrag speichert den beim Erfassen gültigen Preis (rates = {weekday, weekend} seiner Art),
//   damit spätere Preisänderungen alte Einträge nie verändern.
// Teiltage werden anteilig berechnet (Stunden ÷ 8 × Tagessatz).
import { store } from './store.js';
import { HOURS_PER_DAY, fmtNum, fmtDate, addDays } from './format.js';

export const KINDS = { ton: 'Ton', video: 'Video' };

export const DEFAULT_RATES = {
  ton: { weekday: 300, weekend: 350 },
  video: { weekday: 400, weekend: 400 },
};

function complete(r) {
  return {
    ton: { ...DEFAULT_RATES.ton, ...r?.ton },
    video: { ...DEFAULT_RATES.video, ...r?.video },
  };
}

export function getDefaultRates() {
  return complete(store.get('settings', 'rates'));
}

export function saveDefaultRates(rates) {
  store.upsert('settings', { id: 'rates', ton: rates.ton, video: rates.video });
}

// Preis für neue Einträge: Projekt → Kunde → Voreinstellung
export function currentRates(clientId, projectId) {
  const project = projectId && store.get('projects', projectId);
  if (project?.rates) return complete(project.rates);
  const client = clientId && store.get('clients', clientId);
  if (client?.rates) return complete(client.rates);
  return getDefaultRates();
}

// Einträge aus der Zeit vor Ton/Video gelten als Ton
export function entryKind(e) {
  return e.kind === 'video' ? 'video' : 'ton';
}

export function isWeekend(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  return wd === 0 || wd === 6;
}

export function entryRateSet(e) {
  return e.rates || getDefaultRates()[entryKind(e)];
}

// In Tagen erfasste Einträge belegen ab ihrem Datum aufeinanderfolgende Kalendertage
// (je 8 Std., der Rest am letzten Tag). In Stunden erfasste Einträge bleiben ein Tag,
// auch wenn sie länger als 8 Std. sind.
export function entrySpan(e) {
  if (e.unit !== 'd' || e.hours <= HOURS_PER_DAY) return [{ date: e.date, hours: e.hours }];
  const days = [];
  for (let rest = e.hours, i = 0; rest > 0; rest -= HOURS_PER_DAY, i++) {
    days.push({ date: addDays(e.date, i), hours: Math.min(HOURS_PER_DAY, rest) });
  }
  return days;
}

export function entryEndDate(e) {
  const span = entrySpan(e);
  return span[span.length - 1].date;
}

// Jeder Tag zum Satz seines Wochentags
export function entryAmount(e) {
  const set = entryRateSet(e);
  const total = entrySpan(e).reduce((s, d) =>
    s + (d.hours / HOURS_PER_DAY) * (isWeekend(d.date) ? set.weekend : set.weekday), 0);
  return Math.round(total * 100) / 100;
}

// „Mo–Fr“, „Sa/So“ oder bei mehreren Tagen „6× Mo–Fr, 2× Sa/So“
export function dayTypeLabel(e) {
  const span = entrySpan(e);
  const weekend = span.filter(d => isWeekend(d.date)).length;
  const weekday = span.length - weekend;
  if (span.length === 1) return weekend ? 'Sa/So' : 'Mo–Fr';
  return [weekday && `${weekday}× Mo–Fr`, weekend && `${weekend}× Sa/So`].filter(Boolean).join(', ');
}

export function sumAmount(entries) {
  return entries.reduce((s, e) => s + entryAmount(e), 0);
}

// „300/350 €“ bzw. „400 €“
export function setLabel(set) {
  return set.weekday === set.weekend
    ? `${fmtNum(set.weekday)} €`
    : `${fmtNum(set.weekday)}/${fmtNum(set.weekend)} €`;
}

export function ratesLabel(rates) {
  return `Ton ${setLabel(rates.ton)} · Video ${setLabel(rates.video)}`;
}

export function sameSet(a, b) {
  return a.weekday === b.weekday && a.weekend === b.weekend;
}

// Für den PDF-Fuß: alle in diesen Einträgen verwendeten Tagessätze
export function usedRatesLabel(entries) {
  const seen = new Map();
  for (const e of entries) {
    const set = entryRateSet(e);
    const kind = entryKind(e);
    const key = `${kind}|${set.weekday}|${set.weekend}`;
    if (!seen.has(key)) seen.set(key, { kind, set });
  }
  return [...seen.values()]
    .map(({ kind, set }) => set.weekday === set.weekend
      ? `${KINDS[kind]} ${fmtNum(set.weekday)} €/Tag`
      : `${KINDS[kind]} Mo–Fr ${fmtNum(set.weekday)} €, Sa+So ${fmtNum(set.weekend)} €/Tag`)
    .join(' · ');
}

// Preis-Historie: welcher Preis wann bei wie vielen Einträgen verwendet wurde
export function priceHistory(entries) {
  const groups = new Map();
  for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    const set = entryRateSet(e);
    const kind = entryKind(e);
    const key = `${e.projectId || ''}|${kind}|${set.weekday}|${set.weekend}`;
    if (!groups.has(key)) groups.set(key, { projectId: e.projectId || null, kind, set, from: e.date, to: e.date, count: 0 });
    const g = groups.get(key);
    g.to = e.date;
    g.count++;
  }
  return [...groups.values()];
}

export function periodText(from, to) {
  return from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`;
}

// Einmalige Übernahme: Kunden, Projekte und Einträge ohne festgeschriebenen Preis
// bekommen die aktuelle Voreinstellung, damit spätere Änderungen sie nicht mehr berühren.
export function migratePrices() {
  const defaults = getDefaultRates();
  const now = Date.now();
  let changed = 0;
  for (const c of store.doc.clients) {
    if (c.deleted || c.rates) continue;
    c.rates = defaults;
    c.updatedAt = now;
    changed++;
  }
  for (const p of store.doc.projects) {
    if (p.deleted || p.rates) continue;
    p.rates = defaults;
    p.updatedAt = now;
    changed++;
  }
  for (const e of store.doc.entries) {
    if (e.deleted || e.rates) continue;
    e.kind = entryKind(e);
    e.rates = defaults[e.kind];
    e.updatedAt = now;
    changed++;
  }
  if (changed) store.markChanged();
  return changed;
}
