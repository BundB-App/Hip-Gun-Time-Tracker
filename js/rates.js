// Tagessätze und Betragsberechnung. Teiltage werden anteilig berechnet (Stunden ÷ 8 × Tagessatz).
import { store } from './store.js';
import { HOURS_PER_DAY } from './format.js';

export const KINDS = { ton: 'Ton', video: 'Video' };

export const DEFAULT_RATES = {
  ton: { weekday: 300, weekend: 350 },
  video: { weekday: 400, weekend: 400 },
};

export function getRates() {
  const saved = store.get('settings', 'rates');
  return {
    ton: { ...DEFAULT_RATES.ton, ...saved?.ton },
    video: { ...DEFAULT_RATES.video, ...saved?.video },
  };
}

export function saveRates(rates) {
  store.upsert('settings', { id: 'rates', ton: rates.ton, video: rates.video });
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

export function dayRate(kind, iso, rates = getRates()) {
  return rates[kind][isWeekend(iso) ? 'weekend' : 'weekday'];
}

export function entryAmount(e, rates = getRates()) {
  return Math.round((e.hours / HOURS_PER_DAY) * dayRate(entryKind(e), e.date, rates) * 100) / 100;
}

export function sumAmount(entries, rates = getRates()) {
  return entries.reduce((s, e) => s + entryAmount(e, rates), 0);
}

// Kurzbeschreibung der Sätze, z. B. für den PDF-Fuß
export function ratesLabel(rates = getRates()) {
  const part = (label, r) => r.weekday === r.weekend
    ? `${label} ${fmtRate(r.weekday)}/Tag`
    : `${label} Mo–Fr ${fmtRate(r.weekday)}, Sa+So ${fmtRate(r.weekend)}/Tag`;
  return `${part('Ton', rates.ton)} · ${part('Video', rates.video)}`;
}

function fmtRate(n) {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' €';
}
