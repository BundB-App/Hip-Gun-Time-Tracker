// Jahreskalender als Overlay: 12 Monate, gearbeitete Tage nach Ton/Video eingefärbt.
import { store } from './store.js';
import { KINDS, entryKind, entryAmount, sumAmount, entrySpan, entryEndDate } from './rates.js';
import { fmtHours, fmtMoney, fmtDate, fmtDateLong, localISO, todayISO, esc } from './format.js';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// clientId: '' = alle Kunden. onPickMonth(clientId, {from, to}) macht Monatsnamen anklickbar.
export function openCalendar({ clientId = '', onEditEntry, onPickMonth } = {}) {
  const state = { clientId, year: defaultYear(clientId), day: null };

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="Jahreskalender">
      <div class="modal-head">
        <button class="icon-btn" data-cal="prev" aria-label="Vorheriges Jahr">‹</button>
        <h2 id="cal-year"></h2>
        <button class="icon-btn" data-cal="next" aria-label="Nächstes Jahr">›</button>
        <button class="icon-btn close" data-cal="close" aria-label="Schließen">✕</button>
      </div>
      <select id="cal-client" aria-label="Kunde"></select>
      <div class="cal-summary" id="cal-summary"></div>
      <div class="cal-legend">
        <span><i class="sw ton"></i>Ton</span><span><i class="sw video"></i>Video</span><span><i class="sw both"></i>Ton + Video</span>
        ${onPickMonth ? '<span class="hint">Monatsnamen antippen = als Zeitraum übernehmen</span>' : ''}
      </div>
      <div class="cal-grid" id="cal-grid"></div>
      <div id="cal-day"></div>
    </div>`;
  document.body.appendChild(backdrop);
  document.body.classList.add('modal-open');

  const select = backdrop.querySelector('#cal-client');
  const clients = store.clients({ includeArchived: true });
  select.innerHTML = '<option value="">Alle Kunden</option>' +
    clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  select.value = state.clientId;

  function close() {
    backdrop.remove();
    document.body.classList.remove('modal-open');
    removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  addEventListener('keydown', onKey);

  // Einzelne Kalendertage des Jahres; mehrtägige Einträge belegen jeden ihrer Tage
  function daysOfYear() {
    const days = [];
    for (const e of store.all('entries')) {
      if (state.clientId && e.clientId !== state.clientId) continue;
      for (const d of entrySpan(e)) {
        if (d.date.startsWith(state.year + '-')) days.push({ ...d, entry: e });
      }
    }
    return days;
  }

  function render() {
    const days = daysOfYear();
    const entries = [...new Set(days.map(d => d.entry))];
    const byDay = new Map();
    for (const d of days) {
      if (!byDay.has(d.date)) byDay.set(d.date, []);
      byDay.get(d.date).push(d.entry);
    }

    backdrop.querySelector('#cal-year').textContent = state.year;
    const hours = days.reduce((s, d) => s + d.hours, 0);
    backdrop.querySelector('#cal-summary').innerHTML = entries.length
      ? `<b>${byDay.size}</b> ${byDay.size === 1 ? 'Tag' : 'Tage'} · <b>${fmtHours(hours)}</b> Std. · <b>${fmtMoney(sumAmount(entries))}</b>`
      : 'Keine Einträge in diesem Jahr.';

    const today = todayISO();
    let html = '';
    for (let m = 0; m < 12; m++) {
      const first = new Date(state.year, m, 1);
      const daysInMonth = new Date(state.year, m + 1, 0).getDate();
      const offset = (first.getDay() + 6) % 7; // Montag = 0
      const monthKey = `${state.year}-${String(m + 1).padStart(2, '0')}`;
      const monthHours = days.filter(d => d.date.startsWith(monthKey)).reduce((s, d) => s + d.hours, 0);

      let cells = WEEKDAYS.map(d => `<span class="cal-wd">${d}</span>`).join('');
      cells += '<span></span>'.repeat(offset);
      for (let d = 1; d <= daysInMonth; d++) {
        const iso = localISO(new Date(state.year, m, d));
        const list = byDay.get(iso);
        const weekend = (offset + d - 1) % 7 >= 5;
        let cls = 'cal-d';
        if (weekend) cls += ' we';
        if (iso === today) cls += ' today';
        if (iso === state.day) cls += ' sel';
        if (list) {
          const kinds = new Set(list.map(entryKind));
          cls += kinds.size > 1 ? ' both' : ' ' + [...kinds][0];
          const h = days.filter(x => x.date === iso).reduce((s, x) => s + x.hours, 0);
          cells += `<button class="${cls}" data-day="${iso}" title="${fmtHours(h)} Std.">${d}</button>`;
        } else {
          cells += `<span class="${cls}">${d}</span>`;
        }
      }

      const title = onPickMonth
        ? `<button class="cal-mname pick" data-month="${m}">${MONTHS[m]}</button>`
        : `<span class="cal-mname">${MONTHS[m]}</span>`;
      html += `
        <div class="cal-month">
          <div class="cal-mhead">${title}<span class="cal-msum">${monthHours ? fmtHours(monthHours) + ' Std.' : ''}</span></div>
          <div class="cal-days">${cells}</div>
        </div>`;
    }
    backdrop.querySelector('#cal-grid').innerHTML = html;
    renderDay(byDay);
  }

  function renderDay(byDay) {
    const el = backdrop.querySelector('#cal-day');
    const list = state.day && byDay.get(state.day);
    if (!list) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `
      <h3>${fmtDateLong(state.day)}</h3>
      <div class="list">${list.map(e => {
        const client = store.doc.clients.find(c => c.id === e.clientId)?.name || '';
        return `
          <button class="list-item" data-entry="${e.id}">
            <div class="main">
              <div class="title">${esc(client)} <span class="badge kind-${entryKind(e)}">${KINDS[entryKind(e)]}</span></div>
              ${entryEndDate(e) !== e.date ? `<div class="sub">${fmtDate(e.date)} – ${fmtDate(entryEndDate(e))}</div>` : ''}
              ${e.description ? `<div class="desc">${esc(e.description)}</div>` : ''}
            </div>
            <div class="hours">${fmtHours(e.hours)} Std.<div class="money">${fmtMoney(entryAmount(e))}</div></div>
          </button>`;
      }).join('')}</div>`;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) return close();
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.cal === 'close') close();
    else if (t.dataset.cal === 'prev') { state.year--; state.day = null; render(); }
    else if (t.dataset.cal === 'next') { state.year++; state.day = null; render(); }
    else if (t.dataset.day) { state.day = state.day === t.dataset.day ? null : t.dataset.day; render(); }
    else if (t.dataset.entry) { close(); onEditEntry?.(t.dataset.entry); }
    else if (t.dataset.month) {
      const m = Number(t.dataset.month);
      close();
      onPickMonth(state.clientId, {
        from: localISO(new Date(state.year, m, 1)),
        to: localISO(new Date(state.year, m + 1, 0)),
      });
    }
  });

  select.addEventListener('change', () => {
    state.clientId = select.value;
    state.day = null;
    render();
  });

  render();
}

// Aktuelles Jahr, außer der Kunde hat nur ältere Einträge
function defaultYear(clientId) {
  const now = new Date().getFullYear();
  const years = store.all('entries')
    .filter(e => !clientId || e.clientId === clientId)
    .map(e => Number(entryEndDate(e).slice(0, 4)));
  if (!years.length || years.includes(now)) return now;
  return Math.max(...years);
}
