export const HOURS_PER_DAY = 8;

// Rundung auf 30 Minuten
export function roundHalf(hours) {
  return Math.round(hours * 2) / 2;
}

export function parseNumber(value) {
  const n = parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

export function fmtHours(h) {
  return h.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

export function fmtDays(h) {
  const d = h / HOURS_PER_DAY;
  const s = d.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  return s + (d === 1 ? ' Tag' : ' Tage');
}

export function fmtDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function fmtDateLong(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

export function fmtMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

export function todayISO() {
  const d = new Date();
  return localISO(d);
}

export function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function monthRange(offset = 0) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: localISO(first), to: localISO(last) };
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
