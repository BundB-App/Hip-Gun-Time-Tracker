import { store, merge, normalize } from './store.js';
import * as dbx from './dropbox.js';
import { buildTimesheet, deliverPdf } from './pdf.js';
import { openCalendar } from './calendar.js';
import {
  KINDS, getDefaultRates, saveDefaultRates, currentRates, entryKind, entryRateSet, entryAmount, sumAmount,
  setLabel, ratesLabel, sameSet, priceHistory, periodText, migratePrices, entryEndDate, dayTypeLabel,
} from './rates.js';
import {
  HOURS_PER_DAY, roundHalf, parseNumber, fmtHours, fmtNum, fmtDays, fmtMoney, fmtDate, fmtDateLong,
  todayISO, esc,
} from './format.js';

const main = document.getElementById('main');
const tabs = document.getElementById('tabs');
const pill = document.getElementById('sync-pill');

// ---------- Hilfsfunktionen ----------
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function clientName(id) {
  return store.doc.clients.find(c => c.id === id)?.name || 'Unbekannter Kunde';
}

function projectName(id) {
  return store.doc.projects.find(p => p.id === id)?.name || '';
}

function sortEntriesDesc(a, b) {
  return b.date.localeCompare(a.date) || (b.updatedAt || 0) - (a.updatedAt || 0);
}

// Kunden-IDs nach letzter Verwendung
function recentClientIds() {
  const ids = [];
  for (const e of store.all('entries').sort(sortEntriesDesc)) {
    if (!ids.includes(e.clientId)) ids.push(e.clientId);
  }
  return ids;
}

function createClient() {
  const name = prompt('Name des neuen Kunden:')?.trim();
  if (!name) return null;
  const existing = store.clients({ includeArchived: true }).find(c => c.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (existing.archived) store.upsert('clients', { id: existing.id, archived: false });
    toast(`„${existing.name}“ gibt es schon`);
    return existing;
  }
  const c = store.upsert('clients', { name, archived: false, rates: getDefaultRates() });
  // Jeder Kunde hat mindestens ein Projekt; der Name lässt sich später auf der Kunden-Seite ändern
  const projectName = prompt(`Erstes Projekt für ${name}:`, 'Projekt 1')?.trim() || 'Projekt 1';
  store.upsert('projects', { clientId: c.id, name: projectName, archived: false, rates: getDefaultRates() });
  toast(`Kunde „${name}“ mit Projekt „${projectName}“ angelegt`);
  return c;
}

// Vorauswahl: zuletzt verwendetes Projekt des Kunden, sonst das neueste aktive
function defaultProjectId(clientId) {
  const active = store.projectsOf(clientId);
  const last = store.all('entries')
    .filter(e => e.clientId === clientId && e.projectId && active.some(p => p.id === e.projectId))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  if (last) return last.projectId;
  return [...active].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]?.id || null;
}

function lastEntered() {
  return store.all('entries').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;
}

// Kunde des zuletzt erfassten Eintrags
function lastEnteredClientId() {
  return lastEntered()?.clientId || '';
}

function lastEnteredKind() {
  const e = lastEntered();
  return e ? entryKind(e) : 'ton';
}

function createProject(clientId) {
  const name = prompt(`Neues Projekt für ${clientName(clientId)}:`)?.trim();
  if (!name) return null;
  const p = store.upsert('projects', { clientId, name, archived: false, rates: getDefaultRates() });
  toast(`Projekt „${name}“ angelegt`);
  return p;
}

function clientOptionsHtml(selectedId, { placeholder, withNew = false, includeArchived = false } = {}) {
  const active = store.clients({ includeArchived });
  const recent = recentClientIds().filter(id => active.some(c => c.id === id)).slice(0, 5);
  const opt = c => `<option value="${c.id}"${c.id === selectedId ? ' selected' : ''}>${esc(c.name)}${c.archived ? ' (archiviert)' : ''}</option>`;
  let html = placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : '';
  // Ein archivierter Kunde eines bearbeiteten Eintrags muss wählbar bleiben
  const sel = store.get('clients', selectedId);
  if (sel && !active.includes(sel)) html += opt(sel);
  if (recent.length >= 3 && active.length > 6) {
    html += `<optgroup label="Zuletzt verwendet">${recent.map(id => opt(active.find(c => c.id === id)).replace(' selected', '')).join('')}</optgroup>`;
    html += `<optgroup label="Alle Kunden">${active.map(opt).join('')}</optgroup>`;
  } else {
    html += active.map(opt).join('');
  }
  if (withNew) html += '<option value="__new">+ Neuer Kunde …</option>';
  return html;
}

// Mehrtägige Einträge zeigen ihren Zeitraum
function entryDateText(e, long = false) {
  const end = entryEndDate(e);
  if (end === e.date) return long ? fmtDateLong(e.date) : fmtDate(e.date);
  return `${fmtDate(e.date)} – ${fmtDate(end)}`;
}

function kindBadge(e) {
  const k = entryKind(e);
  return `<span class="badge kind-${k}">${KINDS[k]}</span>`;
}

function entryItemHtml(e, { showClient = true, showDate = false } = {}) {
  const proj = e.projectId ? projectName(e.projectId) : '';
  const title = showClient ? esc(clientName(e.clientId)) : '';
  return `
    <button class="list-item" data-edit="${e.id}">
      <div class="main">
        <div class="title">${title} ${kindBadge(e)} ${proj ? `<span class="badge">${esc(proj)}</span>` : ''}</div>
        ${showDate ? `<div class="sub">${entryDateText(e, true)}</div>` : ''}
        ${e.description ? `<div class="desc">${esc(e.description)}</div>` : ''}
      </div>
      <div class="hours">${fmtHours(e.hours)} Std.<div class="money">${fmtMoney(entryAmount(e))}</div></div>
    </button>`;
}

function editFromCalendar(id) {
  editEntry(id, current?.name);
}

function editEntry(id, returnTo) {
  draft.editingId = id;
  draft.returnTo = returnTo;
  show('erfassen');
  scrollTo({ top: 0 });
}

main.addEventListener('click', e => {
  const btn = e.target.closest('[data-edit]');
  if (btn) editEntry(btn.dataset.edit, current?.name === 'erfassen' ? null : current?.name);
});

// ---------- Ansicht: Erfassen ----------
const draft = { editingId: null, returnTo: null, unit: 'h', kind: null, date: null, clientId: null, projectId: null };

function viewErfassen(root) {
  const editing = draft.editingId ? store.get('entries', draft.editingId) : null;
  if (!editing) draft.editingId = null;
  let unit = editing ? (editing.unit || 'h') : draft.unit;
  // Ohne eigene Wahl in dieser Sitzung: Art des zuletzt erfassten Eintrags
  let kind = editing ? entryKind(editing) : draft.kind || lastEnteredKind();

  root.innerHTML = `
    <h2${editing ? '' : ' class="hide-narrow"'}>${editing ? 'Eintrag bearbeiten' : 'Zeit erfassen'}</h2>
    <form class="card compact-form" id="entry-form" autocomplete="off" novalidate>
      <div class="row">
        <label class="field date-field"><span>Datum</span><input type="date" name="date" required></label>
        <label class="field"><span>Kunde</span><select name="client"></select></label>
      </div>
      <div id="project-wrap"></div>
      <div class="field"><span>Art &amp; Tagessatz</span>
        <div class="kind-row">
          <div class="segmented kind-seg" id="kind">
            <button type="button" data-kind="ton">Ton<small id="price-ton"></small></button><button type="button" data-kind="video">Video<small id="price-video"></small></button>
          </div>
          <button type="button" class="link" data-act="toggle-price" id="price-toggle">Preis ändern</button>
        </div>
        <!-- Preisfelder eingeklappt, damit Dauer und Speichern ohne Scrollen sichtbar sind -->
        <div id="price-edit" hidden>
          <div class="row" style="margin-top:10px">
            <label class="field" style="margin:0"><span>Mo–Fr (€/Tag)</span><input name="rateWeekday" inputmode="decimal"></label>
            <label class="field" style="margin:0"><span>Sa+So (€/Tag)</span><input name="rateWeekend" inputmode="decimal"></label>
          </div>
          <div class="hint" id="price-hint"></div>
        </div>
      </div>
      <div class="field"><span>Dauer</span>
        <div class="row">
          <input name="amount" inputmode="decimal" placeholder="z. B. 3,5" enterkeyhint="next">
          <div class="segmented grow-0" id="unit">
            <button type="button" data-unit="h">Std.</button><button type="button" data-unit="d">Tage</button>
          </div>
        </div>
        <div class="chips" id="chips"></div>
        <div class="hint" id="duration-hint"></div>
      </div>
      <label class="field"><span>Beschreibung</span><textarea name="description" rows="2" placeholder="Was wurde gemacht?"></textarea></label>
      <div class="actions">
        <button class="btn primary" type="submit">${editing ? 'Änderungen speichern' : 'Speichern'}</button>
        ${editing ? '<button class="btn" type="button" data-act="cancel">Abbrechen</button><button class="btn danger" type="button" data-act="delete">Löschen</button>' : ''}
      </div>
    </form>
    ${editing ? '' : '<h3>Zuletzt erfasst</h3><div id="recent"></div>'}`;

  const form = root.querySelector('form');
  const f = form.elements;
  const projectWrap = root.querySelector('#project-wrap');
  let projectId = editing ? editing.projectId : draft.projectId;
  // Arbeitskopie der Preise beider Arten; beim Bearbeiten gilt der im Eintrag gespeicherte Preis
  let prices;

  f.date.value = editing?.date || draft.date || todayISO();
  // Vorauswahl: zuletzt erfasster Kunde; dessen zuletzt verwendetes Projekt wählt renderProject()
  const initialClient = editing?.clientId || draft.clientId || lastEnteredClientId();
  if (editing) {
    f.amount.value = fmtHours(unit === 'd' ? editing.hours / HOURS_PER_DAY : editing.hours);
    f.description.value = editing.description || '';
  }

  function renderClients(selected) {
    f.client.innerHTML = clientOptionsHtml(selected, { placeholder: 'Kunde wählen …', withNew: true });
    f.client.value = store.get('clients', selected) ? selected : '';
  }

  function renderProject() {
    const clientId = f.client.value;
    const projects = clientId ? store.projectsOf(clientId) : [];
    const current = projectId ? store.get('projects', projectId) : null;
    if (current && current.clientId === clientId && !projects.includes(current)) projects.push(current);
    if (clientId && !projects.some(p => p.id === projectId)) projectId = defaultProjectId(clientId);
    if (!clientId) {
      projectWrap.innerHTML = '';
    } else if (projects.length) {
      projectWrap.innerHTML = `
        <label class="field"><span>Projekt</span>
          <select name="project">
            ${projects.map(p => `<option value="${p.id}"${p.id === projectId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
            <option value="__new">+ Neues Projekt …</option>
          </select>
        </label>`;
    } else {
      projectWrap.innerHTML = `<div class="field" style="margin-top:-8px"><button type="button" class="link" data-act="add-project">+ Projekt für diesen Kunden anlegen</button></div>`;
    }
  }

  function renderUnit() {
    root.querySelectorAll('#unit button').forEach(b => b.classList.toggle('on', b.dataset.unit === unit));
    // Einheit steht am Umschalter, die Schnellwahl zeigt nur Zahlen (passt in eine Zeile)
    const values = unit === 'h' ? [1, 2, 3, 4, 5, 6, 7, 8] : [0.5, 1, 2, 3, 4, 5, 6, 7, 8];
    root.querySelector('#chips').innerHTML = values
      .map(v => `<button type="button" class="chip" data-chip="${v}">${fmtHours(v)}</button>`)
      .join('');
    renderHint();
  }

  function computedHours() {
    const n = parseNumber(f.amount.value);
    if (!(n > 0)) return NaN;
    return roundHalf(unit === 'd' ? n * HOURS_PER_DAY : n);
  }

  function loadPrices() {
    prices = currentRates(f.client.value, projectId);
    if (editing && editing.rates) prices[entryKind(editing)] = { ...editing.rates };
    fillPriceInputs();
  }

  function fillPriceInputs() {
    f.rateWeekday.value = fmtNum(prices[kind].weekday);
    f.rateWeekend.value = fmtNum(prices[kind].weekend);
    renderPriceInfo();
  }

  function readPriceInputs() {
    const weekday = parseNumber(f.rateWeekday.value);
    const weekend = parseNumber(f.rateWeekend.value);
    if (weekday >= 0) prices[kind].weekday = weekday;
    if (weekend >= 0) prices[kind].weekend = weekend;
    renderPriceInfo();
  }

  function renderPriceInfo() {
    root.querySelector('#price-ton').textContent = setLabel(prices.ton);
    root.querySelector('#price-video').textContent = setLabel(prices.video);
    const clientId = f.client.value;
    const hint = root.querySelector('#price-hint');
    if (editing) {
      hint.textContent = 'Preis wie beim Erfassen gespeichert. Eine Änderung gilt nur für diesen Eintrag.';
    } else if (clientId) {
      const source = projectId ? `Projekt „${projectName(projectId)}“` : `Kunde „${clientName(clientId)}“`;
      const changed = !sameSet(prices[kind], currentRates(clientId, projectId)[kind]);
      hint.textContent = changed
        ? `Neuer Preis – wird beim Speichern für ${source} übernommen und gilt ab dann.`
        : `Aktueller Preis für ${source}.`;
    } else {
      hint.textContent = 'Voreinstellung. Nach Wahl des Kunden steht hier sein Preis.';
    }
    renderHint();
  }

  function setPriceOpen(open) {
    root.querySelector('#price-edit').hidden = !open;
    root.querySelector('#price-toggle').textContent = open ? 'Preis ausblenden' : 'Preis ändern';
  }

  function renderKind() {
    root.querySelectorAll('#kind button').forEach(b => b.classList.toggle('on', b.dataset.kind === kind));
    fillPriceInputs();
  }

  function renderHint() {
    const n = parseNumber(f.amount.value);
    const h = computedHours();
    let text = '';
    if (n > 0) {
      if (h === 0) text = 'Mindestens 0,5 Std.';
      else if (unit === 'd') text = `= ${fmtHours(h)} Std.`;
      else if (h !== n) text = `Wird auf ${fmtHours(h)} Std. gerundet.`;
      else text = '';
    }
    if (h > 0 && f.date.value) {
      const draftEntry = { hours: h, kind, unit, date: f.date.value, rates: prices[kind] };
      const end = entryEndDate(draftEntry);
      const span = end !== draftEntry.date ? ` · bis ${fmtDate(end)}` : '';
      text = (text ? text + ' · ' : '') + `${fmtMoney(entryAmount(draftEntry))} (${KINDS[kind]}, ${dayTypeLabel(draftEntry)})${span}`;
    }
    root.querySelector('#duration-hint').textContent = text;
  }

  function renderRecent() {
    const el = root.querySelector('#recent');
    if (!el) return;
    const items = store.all('entries').sort(sortEntriesDesc).slice(0, 5);
    el.innerHTML = items.length
      ? `<div class="list">${items.map(e => entryItemHtml(e, { showDate: true })).join('')}</div>`
      : '<div class="empty">Noch keine Einträge.</div>';
  }

  renderClients(initialClient);
  let lastClient = f.client.value;
  renderProject();
  prices = currentRates(f.client.value, projectId);
  if (editing && editing.rates) prices[entryKind(editing)] = { ...editing.rates };
  renderUnit();
  renderKind();
  renderRecent();

  form.addEventListener('change', e => {
    if (e.target.name === 'client') {
      if (f.client.value === '__new') {
        const c = createClient();
        renderClients(c ? c.id : lastClient);
      }
      lastClient = f.client.value;
      projectId = null;
      renderProject();
      if (!editing) loadPrices();
    }
    if (e.target.name === 'project') {
      if (e.target.value === '__new') {
        const p = createProject(f.client.value);
        if (p) projectId = p.id;
        renderProject();
      } else {
        projectId = e.target.value || null;
      }
      if (!editing) loadPrices();
    }
  });

  form.addEventListener('input', e => {
    if (e.target.name === 'amount' || e.target.name === 'date') renderHint();
    if (e.target.name === 'rateWeekday' || e.target.name === 'rateWeekend') readPriceInputs();
  });

  form.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.unit) {
      unit = t.dataset.unit;
      if (!editing) draft.unit = unit;
      renderUnit();
    } else if (t.dataset.kind) {
      kind = t.dataset.kind;
      if (!editing) draft.kind = kind;
      renderKind();
    } else if (t.dataset.chip) {
      f.amount.value = fmtHours(Number(t.dataset.chip));
      renderHint();
    } else if (t.dataset.act === 'add-project') {
      const p = createProject(f.client.value);
      if (p) { projectId = p.id; renderProject(); if (!editing) loadPrices(); }
    } else if (t.dataset.act === 'toggle-price') {
      setPriceOpen(root.querySelector('#price-edit').hidden);
    } else if (t.dataset.act === 'cancel') {
      leaveEdit();
    } else if (t.dataset.act === 'delete') {
      if (confirm('Diesen Eintrag löschen?')) {
        store.remove('entries', editing.id);
        toast('Eintrag gelöscht');
        leaveEdit();
      }
    }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const clientId = f.client.value;
    const hours = computedHours();
    if (!f.date.value) return toast('Bitte ein Datum wählen');
    if (!clientId || clientId === '__new') return toast('Bitte einen Kunden wählen');
    if (!projectId) return toast('Bitte ein Projekt wählen oder anlegen');
    if (!(hours > 0)) return toast('Bitte eine Dauer eingeben (mind. 0,5 Std.)');
    const set = { weekday: parseNumber(f.rateWeekday.value), weekend: parseNumber(f.rateWeekend.value) };
    if (!(set.weekday >= 0 && set.weekend >= 0)) return toast('Bitte gültige Tagessätze eingeben');
    let priceNote = '';
    if (!editing) {
      // Geänderter Preis gilt ab jetzt für diesen Kunden bzw. dieses Projekt
      const source = currentRates(clientId, projectId);
      if (!sameSet(set, source[kind])) {
        const rates = { ...source, [kind]: set };
        if (projectId) store.upsert('projects', { id: projectId, rates });
        else store.upsert('clients', { id: clientId, rates });
        priceNote = ' · neuer Preis übernommen';
      }
    }
    const saved = store.upsert('entries', {
      id: editing?.id,
      date: f.date.value,
      clientId,
      projectId: projectId || null,
      kind,
      rates: set,
      hours,
      unit,
      description: f.description.value.trim(),
    });
    toast(`${fmtHours(hours)} Std. ${KINDS[kind]} für ${clientName(clientId)} gespeichert (${fmtMoney(entryAmount(saved))})${priceNote}`);
    if (editing) return leaveEdit();
    draft.date = f.date.value;
    draft.clientId = clientId;
    draft.projectId = projectId;
    f.amount.value = '';
    f.description.value = '';
    renderPriceInfo();
  });

  function leaveEdit() {
    const back = draft.returnTo;
    draft.editingId = null;
    draft.returnTo = null;
    show(back || 'erfassen');
  }

  return () => {
    // Kommen Daten erst per Sync an, die Vorauswahl nachholen
    const empty = !f.client.value && !editing;
    renderClients(empty ? lastEnteredClientId() : f.client.value);
    lastClient = f.client.value;
    renderProject();
    if (empty && f.client.value) loadPrices();
    renderRecent();
  };
}

const CAL_ICON = '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';

// ---------- Ansicht: Kunden ----------
const clientUI = { q: '', showArchived: false, open: null, priceEdit: null };

// Eingabefelder für alle vier Tagessätze; target = 'client:<id>' | 'project:<id>'
function priceEditorHtml(target, rates) {
  const input = (kind, day, label) =>
    `<label class="field" style="margin:0"><span>${label}</span><input inputmode="decimal" data-price="${kind}.${day}" value="${fmtNum(rates[kind][day])}"></label>`;
  return `
    <div class="price-editor" data-target="${target}">
      <div class="row">${input('ton', 'weekday', 'Ton Mo–Fr €')}${input('ton', 'weekend', 'Ton Sa+So €')}</div>
      <div class="row">${input('video', 'weekday', 'Video Mo–Fr €')}${input('video', 'weekend', 'Video Sa+So €')}</div>
    </div>`;
}

function readPriceEditor(container) {
  const rates = { ton: {}, video: {} };
  for (const input of container.querySelectorAll('[data-price]')) {
    const [kind, day] = input.dataset.price.split('.');
    const n = parseNumber(input.value);
    if (!(n >= 0)) return null;
    rates[kind][day] = n;
  }
  return rates;
}

function viewKunden(root) {
  root.innerHTML = `
    <h2>Kunden</h2>
    <div class="row" style="margin-bottom:10px">
      <input type="search" id="q" placeholder="Suchen …" value="${esc(clientUI.q)}">
      <button class="btn grow-0" data-act="calendar" title="Jahreskalender aller Kunden">${CAL_ICON}</button>
      <button class="btn primary grow-0" data-act="new">+ Kunde</button>
    </div>
    <label class="hint" style="display:flex;gap:8px;align-items:center;margin-bottom:14px">
      <input type="checkbox" id="archived" style="width:auto"${clientUI.showArchived ? ' checked' : ''}> Archivierte Kunden anzeigen
    </label>
    <div id="clients"></div>`;

  root.querySelector('#q').addEventListener('input', e => { clientUI.q = e.target.value; update(); });
  root.querySelector('#archived').addEventListener('change', e => { clientUI.showArchived = e.target.checked; update(); });

  root.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const id = t.dataset.id;
    const act = t.dataset.act;
    if (act === 'new') {
      const c = createClient();
      if (c) { clientUI.open = c.id; update(); }
    } else if (act === 'calendar') {
      openCalendar({ clientId: id || '', onEditEntry: editFromCalendar });
    } else if (act === 'toggle') {
      clientUI.open = clientUI.open === id ? null : id;
      update();
    } else if (act === 'rename') {
      const c = store.get('clients', id);
      const name = prompt('Neuer Name:', c.name)?.trim();
      if (name) store.upsert('clients', { id, name });
    } else if (act === 'archive') {
      const c = store.get('clients', id);
      store.upsert('clients', { id, archived: !c.archived });
      toast(c.archived ? 'Kunde reaktiviert' : 'Kunde archiviert');
    } else if (act === 'delete') {
      const count = store.all('entries').filter(x => x.clientId === id).length;
      if (count) return toast('Kunde hat Einträge, bitte stattdessen archivieren');
      if (confirm('Kunden endgültig löschen?')) {
        store.projectsOf(id, { includeArchived: true }).forEach(p => store.remove('projects', p.id));
        store.remove('clients', id);
      }
    } else if (act === 'proj-add') {
      createProject(id);
    } else if (act === 'proj-rename') {
      const p = store.get('projects', id);
      const name = prompt('Neuer Projektname:', p.name)?.trim();
      if (name) store.upsert('projects', { id, name });
    } else if (act === 'proj-archive') {
      const p = store.get('projects', id);
      store.upsert('projects', { id, archived: !p.archived });
    } else if (act === 'edit-prices') {
      clientUI.priceEdit = clientUI.priceEdit === id ? null : id;
      update();
    } else if (act === 'save-prices') {
      const rates = readPriceEditor(root.querySelector(`.price-editor[data-target="${id}"]`));
      if (!rates) return toast('Bitte gültige Beträge eingeben');
      const [type, recId] = id.split(':');
      clientUI.priceEdit = null;
      store.upsert(type === 'project' ? 'projects' : 'clients', { id: recId, rates });
      toast('Neuer Preis gespeichert – gilt ab jetzt für neue Einträge');
    }
  });

  function update() {
    const q = clientUI.q.trim().toLowerCase();
    const clients = store.clients({ includeArchived: clientUI.showArchived })
      .filter(c => !q || c.name.toLowerCase().includes(q));
    const entries = store.all('entries');
    const el = root.querySelector('#clients');
    if (!clients.length) {
      el.innerHTML = `<div class="empty">${q ? 'Kein Kunde gefunden.' : 'Noch keine Kunden. Lege oben deinen ersten Kunden an.'}</div>`;
      return;
    }
    el.innerHTML = `<div class="list">${clients.map(c => {
      const own = entries.filter(e => e.clientId === c.id);
      const sum = own.reduce((s, e) => s + e.hours, 0);
      const projects = store.projectsOf(c.id, { includeArchived: true });
      const open = clientUI.open === c.id;
      return `
        <button class="list-item" data-act="toggle" data-id="${c.id}">
          <div class="main">
            <div class="title">${esc(c.name)} ${c.archived ? '<span class="badge grey">archiviert</span>' : ''}</div>
            <div class="sub">${own.length} ${own.length === 1 ? 'Eintrag' : 'Einträge'} · ${fmtHours(sum)} Std. · ${fmtMoney(sumAmount(own))}${projects.length ? ` · ${projects.length} ${projects.length === 1 ? 'Projekt' : 'Projekte'}` : ''}</div>
          </div>
          <div class="sub">${open ? '▴' : '▾'}</div>
        </button>
        ${open ? `
        <div class="client-detail">
          <h3>Projekte &amp; Preise</h3>
          ${projects.map(p => `
            <div class="proj">
              <span class="name">${esc(p.name)} ${p.archived ? '<span class="badge grey">archiviert</span>' : ''}
                <div class="sub">${ratesLabel(currentRates(c.id, p.id))}</div></span>
              <button class="btn small" data-act="edit-prices" data-id="project:${p.id}">Preis</button>
              <button class="btn small" data-act="proj-rename" data-id="${p.id}">Umbenennen</button>
              <button class="btn small" data-act="proj-archive" data-id="${p.id}">${p.archived ? 'Reaktivieren' : 'Archivieren'}</button>
            </div>
            ${clientUI.priceEdit === 'project:' + p.id ? priceEditBlock('project:' + p.id, currentRates(c.id, p.id)) : ''}`).join('') || '<div class="hint">Noch keine Projekte. Bitte ein Projekt anlegen, um Zeiten zu erfassen.</div>'}
          <button class="link" data-act="proj-add" data-id="${c.id}">+ Projekt hinzufügen</button>
          <p class="hint" style="margin:2px 0 0">Neue Projekte starten mit der aktuellen Voreinstellung aus den Einstellungen.</p>
          ${historyHtml(own)}
          <div class="actions" style="margin-top:12px">
            <button class="btn small" data-act="calendar" data-id="${c.id}">${CAL_ICON} Kalender</button>
            <button class="btn small" data-act="rename" data-id="${c.id}">Umbenennen</button>
            <button class="btn small" data-act="archive" data-id="${c.id}">${c.archived ? 'Reaktivieren' : 'Archivieren'}</button>
            <button class="btn small danger" data-act="delete" data-id="${c.id}">Löschen</button>
          </div>
        </div>` : ''}`;
    }).join('')}</div>`;
  }

  function priceEditBlock(target, rates) {
    return `
      <div class="price-edit-block">
        ${priceEditorHtml(target, rates)}
        <p class="hint">Gilt für neue Einträge. Bereits erfasste Einträge behalten ihren Preis.</p>
        <div class="actions">
          <button class="btn small primary" data-act="save-prices" data-id="${target}">Speichern</button>
          <button class="btn small" data-act="edit-prices" data-id="${target}">Abbrechen</button>
        </div>
      </div>`;
  }

  // Dokumentiert, zu welchem Preis wann abgerechnet wurde
  function historyHtml(entries) {
    const rows = priceHistory(entries);
    if (!rows.length) return '';
    return `
      <h3>Abgerechnete Preise</h3>
      <div class="history">${rows.map(r => `
        <div class="history-row">
          <div><span class="badge kind-${r.kind}">${KINDS[r.kind]}</span> <b>${setLabel(r.set)}</b>/Tag${r.projectId ? ` <span class="badge">${esc(projectName(r.projectId))}</span>` : ''}</div>
          <div class="sub">${periodText(r.from, r.to)} · ${r.count} ${r.count === 1 ? 'Eintrag' : 'Einträge'}</div>
        </div>`).join('')}</div>`;
  }

  update();
  return update;
}

// ---------- Ansicht: Stundenzettel ----------
// open: aufgeklappte Projekte; null = Standard (nur das jüngste Projekt offen)
const pdfUI = { clientId: '', open: null };

// Alle Einträge des Kunden, nach Projekt gruppiert, jüngstes Projekt zuerst
function timesheetGroups() {
  const entries = store.all('entries')
    .filter(e => e.clientId === pdfUI.clientId)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.updatedAt || 0) - (b.updatedAt || 0));
  const map = new Map();
  for (const e of entries) {
    const key = e.projectId || '';
    if (!map.has(key)) map.set(key, { key, name: key ? projectName(key) : null, entries: [] });
    map.get(key).entries.push(e);
  }
  const latest = g => g.entries.reduce((m, e) => {
    const k = e.date + String(e.updatedAt || 0).padStart(15, '0');
    return k > m ? k : m;
  }, '');
  return [...map.values()].sort((a, b) => latest(b).localeCompare(latest(a)));
}

// Tatsächlich verwendete Preise, z. B. „Ton 300/350 € · Video 400 €“
function usedPricesText(entries) {
  const seen = new Map();
  for (const e of entries) {
    const kind = entryKind(e);
    const set = entryRateSet(e);
    seen.set(`${kind}|${set.weekday}|${set.weekend}`, `${KINDS[kind]} ${setLabel(set)}`);
  }
  return [...seen.values()].sort().join(' · ');
}

function viewPdf(root) {
  root.innerHTML = `
    <h2>Stundenzettel</h2>
    <div class="row" style="margin-bottom:14px">
      <select id="p-client" aria-label="Kunde"></select>
      <button class="btn grow-0" data-act="calendar" title="Jahreskalender">${CAL_ICON}</button>
    </div>
    <div id="preview"></div>
    <button class="btn primary block" id="make-pdf">PDF mit allen Projekten</button>`;

  const clientSel = root.querySelector('#p-client');
  clientSel.addEventListener('change', () => { pdfUI.clientId = clientSel.value; pdfUI.open = null; update(); });

  root.querySelector('[data-act=calendar]').addEventListener('click', () =>
    openCalendar({ clientId: pdfUI.clientId, onEditEntry: editFromCalendar }));

  root.querySelector('#preview').addEventListener('click', e => {
    const pdfBtn = e.target.closest('[data-pdf-project]');
    if (pdfBtn) return makePdf(pdfBtn.dataset.pdfProject);
    // Projekt auf- bzw. zuklappen
    const head = e.target.closest('[data-toggle-group]');
    if (!head) return;
    const key = head.dataset.toggleGroup;
    if (pdfUI.open.has(key)) pdfUI.open.delete(key);
    else pdfUI.open.add(key);
    update();
  });

  root.querySelector('#make-pdf').addEventListener('click', () => makePdf(null));

  // projectKey = null: alle Projekte
  async function makePdf(projectKey) {
    const groups = timesheetGroups().filter(g => projectKey === null || g.key === projectKey);
    if (!groups.length) return;
    // Zeitraum ergibt sich aus den enthaltenen Einträgen
    const all = groups.flatMap(g => g.entries);
    const from = all.reduce((m, e) => (e.date < m ? e.date : m), all[0].date);
    const to = all.reduce((m, e) => { const end = entryEndDate(e); return end > m ? end : m; }, all[0].date);
    try {
      const name = clientName(pdfUI.clientId);
      const doc = await buildTimesheet({ clientName: name, from, to, groups });
      const slug = t => t.replace(/[^\wäöüÄÖÜß-]+/g, '_').replace(/^_|_$/g, '');
      const project = projectKey !== null && groups[0].name ? '_' + slug(groups[0].name) : '';
      await deliverPdf(doc, `Stundenzettel_${slug(name)}${project}_${todayISO()}.pdf`);
    } catch (err) {
      console.error(err);
      toast('PDF konnte nicht erstellt werden');
    }
  }

  function update() {
    clientSel.innerHTML = clientOptionsHtml(pdfUI.clientId, { placeholder: 'Kunde wählen …', includeArchived: true });
    clientSel.value = pdfUI.clientId;

    const preview = root.querySelector('#preview');
    const button = root.querySelector('#make-pdf');
    if (!pdfUI.clientId) {
      preview.innerHTML = '<div class="empty">Wähle einen Kunden, um den Stundenzettel zu sehen.</div>';
      button.disabled = true;
      return;
    }
    const groups = timesheetGroups();
    button.disabled = !groups.length;
    if (!groups.length) {
      preview.innerHTML = '<div class="empty">Für diesen Kunden gibt es noch keine Einträge.</div>';
      return;
    }
    if (!pdfUI.open) pdfUI.open = new Set([groups[0].key]);
    const single = groups.length === 1;
    button.textContent = single ? 'PDF erstellen' : 'PDF mit allen Projekten';
    let total = 0, money = 0;
    let html = '<div class="list">';
    for (const g of groups) {
      const sum = g.entries.reduce((s, e) => s + e.hours, 0);
      const amount = sumAmount(g.entries);
      total += sum;
      money += amount;
      const open = single || pdfUI.open.has(g.key);
      html += `
        <button class="group-head group-toggle${open ? ' open' : ''}" ${single ? 'disabled' : `data-toggle-group="${g.key}"`} aria-expanded="${open}">
          <span><span class="chev">›</span>${esc(g.name || 'Ohne Projekt')} <span class="count">${g.entries.length}</span>
            <span class="group-prices">${usedPricesText(g.entries)}</span></span>
          <span>${fmtHours(sum)} Std. · ${fmtMoney(amount)}</span>
        </button>`;
      if (!open) continue;
      html += g.entries.map(e => `
        <button class="list-item" data-edit="${e.id}">
          <div class="sub" style="width:80px;flex:none">${entryDateText(e).replace(' – ', ' –<br>')}</div>
          <div class="main"><div class="desc" style="margin:0">${kindBadge(e)} ${esc(e.description) || '–'}</div></div>
          <div class="hours">${fmtHours(e.hours)}<div class="money">${fmtMoney(entryAmount(e))}</div></div>
        </button>`).join('');
      if (!single) html += `<div class="group-actions"><button class="btn small" data-pdf-project="${g.key}">PDF nur für dieses Projekt</button></div>`;
    }
    html += `</div><div class="list"><div class="summary"><span>Gesamt <span class="hint">${fmtHours(total)} Std. (${fmtDays(total)})</span></span><span class="big">${fmtMoney(money)}</span></div></div>`;
    preview.innerHTML = html;
  }

  update();
  return update;
}

// ---------- Ansicht: Einstellungen ----------
function viewEinstellungen(root) {
  function render() {
    const s = dbx.getSettings();
    const connected = dbx.isConnected();
    const last = dbx.lastSyncAt();
    const codeFirst = dbx.prefersCodeFlow();
    const counts = { k: store.clients({ includeArchived: true }).length, e: store.all('entries').length };
    const rates = getDefaultRates();

    const codeFlow = `
      <div class="field">
        <span>${codeFirst ? 'Verbinden' : 'Alternative: Code-Verfahren'}</span>
        <ol class="steps hint">
          <li>„Code bei Dropbox holen“ tippen und den Zugriff erlauben.</li>
          <li>Den angezeigten Code kopieren und hier einfügen.</li>
        </ol>
        <div class="actions"><button class="btn${codeFirst ? ' primary' : ''}" data-act="code-start">Code bei Dropbox holen</button></div>
        <div class="row" style="margin-top:10px">
          <input id="auth-code" placeholder="Code einfügen" autocapitalize="off" autocomplete="off">
          <button class="btn grow-0" data-act="code-submit">Bestätigen</button>
        </div>
      </div>`;

    root.innerHTML = `
      <h2>Einstellungen</h2>
      <div class="card">
        <h3 style="margin-top:0">Dropbox</h3>
        ${connected ? `
          <p style="margin-top:0"><span class="badge">Verbunden</span> ${last ? `Letzter Sync: ${new Date(last).toLocaleString('de-DE')}` : ''}</p>
          ${dbx.syncState.error ? `<p class="hint" style="color:var(--danger)">${esc(dbx.syncState.error)}</p>` : ''}
          <label class="field"><span>Datei in der Dropbox</span>
            <div class="row"><input id="data-path" value="${esc(s.dataPath)}"><button class="btn grow-0" data-act="save-path">Speichern</button></div>
          </label>
          <div class="actions">
            <button class="btn primary" data-act="sync">Jetzt synchronisieren</button>
            <button class="btn danger" data-act="disconnect">Trennen</button>
          </div>
        ` : `
          <label class="field"><span>Dropbox App Key</span><input id="app-key" value="${esc(s.appKey)}" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
          <label class="field"><span>Datei in der Dropbox</span><input id="data-path" value="${esc(s.dataPath)}" autocapitalize="off"></label>
          <p class="hint">Redirect URI für die Dropbox-App:<br><code>${esc(dbx.redirectUri())}</code></p>
          ${codeFirst ? codeFlow : `
            <div class="actions" style="margin-bottom:16px"><button class="btn primary" data-act="connect">Mit Dropbox verbinden</button></div>
            ${codeFlow}`}
        `}
      </div>

      <div class="card">
        <h3 style="margin-top:0">Voreinstellung Tagessätze (netto)</h3>
        <p class="hint" style="margin-top:0">Gilt für <b>neue Kunden</b> und für <b>neue Projekte</b> – auch bei bestehenden Kunden. Bereits angelegte Projekte und erfasste Einträge behalten ihre Preise. Teiltage werden anteilig berechnet (Stunden ÷ 8 × Tagessatz).</p>
        <div class="row">
          <label class="field"><span>Ton Mo–Fr (€)</span><input inputmode="decimal" data-rate="ton.weekday" value="${fmtNum(rates.ton.weekday)}"></label>
          <label class="field"><span>Ton Sa+So (€)</span><input inputmode="decimal" data-rate="ton.weekend" value="${fmtNum(rates.ton.weekend)}"></label>
        </div>
        <div class="row">
          <label class="field"><span>Video Mo–Fr (€)</span><input inputmode="decimal" data-rate="video.weekday" value="${fmtNum(rates.video.weekday)}"></label>
          <label class="field"><span>Video Sa+So (€)</span><input inputmode="decimal" data-rate="video.weekend" value="${fmtNum(rates.video.weekend)}"></label>
        </div>
        <div class="actions"><button class="btn" data-act="save-rates">Voreinstellung speichern</button></div>
      </div>

      <div class="card">
        <h3 style="margin-top:0">Daten</h3>
        <p style="margin-top:0">${counts.k} Kunden · ${counts.e} Einträge${store.dirty ? ' · <span class="badge grey">nicht synchronisierte Änderungen</span>' : ''}</p>
        <div class="actions">
          <button class="btn" data-act="export">Backup herunterladen</button>
          <button class="btn" data-act="import">Backup einspielen</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
        </div>
      </div>

      <a class="card list-link" href="#anleitung">
        <div>
          <div class="title">Anleitung: App auf dem iPhone nutzen</div>
          <div class="hint" style="margin:2px 0 0">Alle Schritte von der Installation bis zur Dropbox-Verbindung</div>
        </div>
        <span class="chev">›</span>
      </a>`;
  }

  function saveInputs() {
    const appKey = root.querySelector('#app-key')?.value.trim();
    const dataPath = root.querySelector('#data-path')?.value.trim();
    const patch = {};
    if (appKey !== undefined) patch.appKey = appKey;
    if (dataPath) patch.dataPath = dataPath.startsWith('/') ? dataPath : '/' + dataPath;
    dbx.saveSettings(patch);
  }

  root.addEventListener('click', async e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    try {
      switch (t.dataset.act) {
        case 'connect':
          saveInputs();
          await dbx.startAuth({ withRedirect: true });
          break;
        case 'code-start':
          saveInputs();
          await dbx.startAuth({ withRedirect: false });
          break;
        case 'code-submit': {
          const code = root.querySelector('#auth-code').value;
          if (!code.trim()) return toast('Bitte den Code einfügen');
          await dbx.submitManualCode(code);
          toast('Mit Dropbox verbunden');
          render();
          dbx.sync();
          break;
        }
        case 'save-rates': {
          const rates = getDefaultRates();
          for (const input of root.querySelectorAll('[data-rate]')) {
            const [kind, day] = input.dataset.rate.split('.');
            const n = parseNumber(input.value);
            if (!(n >= 0)) return toast('Bitte gültige Beträge eingeben');
            rates[kind][day] = n;
          }
          saveDefaultRates(rates);
          toast('Voreinstellung gespeichert – gilt für neue Kunden und Projekte');
          break;
        }
        case 'save-path':
          saveInputs();
          toast('Gespeichert');
          dbx.sync();
          break;
        case 'sync':
          await dbx.sync();
          if (dbx.syncState.status === 'ok') toast('Synchronisiert');
          break;
        case 'disconnect':
          if (confirm('Verbindung zu Dropbox trennen? Die Daten bleiben auf diesem Gerät und in der Dropbox erhalten.')) {
            dbx.disconnect();
            render();
            updatePill();
          }
          break;
        case 'export': {
          const blob = new Blob([JSON.stringify(store.doc, null, 1)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `time-tracker-backup-${todayISO()}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 10000);
          break;
        }
        case 'import':
          root.querySelector('#import-file').click();
          break;
      }
    } catch (err) {
      toast(err.message);
    }
  });

  root.addEventListener('change', async e => {
    if (e.target.id !== 'import-file' || !e.target.files[0]) return;
    try {
      const imported = normalize(JSON.parse(await e.target.files[0].text()));
      store.replaceAll(merge(store.doc, imported).doc);
      toast('Backup eingespielt');
    } catch {
      toast('Datei konnte nicht gelesen werden');
    }
  });

  render();
  // Nicht neu zeichnen, während ein Eingabefeld bearbeitet wird
  return () => {
    if (root.contains(document.activeElement) && document.activeElement.matches('input')) return;
    render();
  };
}

// ---------- Ansicht: Anleitung iPhone ----------
const APP_URL = 'https://bundb-app.github.io/Hip-Gun-Time-Tracker/';

function viewAnleitung(root) {
  const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  const step = (n, title, body) => `
    <div class="card guide-step">
      <div class="guide-num">${n}</div>
      <div class="guide-body"><h4>${title}</h4>${body}</div>
    </div>`;

  root.innerHTML = `
    <p style="margin:0 0 8px"><a href="#einstellungen" class="link">‹ Einstellungen</a></p>
    <h2>App auf dem iPhone nutzen</h2>
    <p class="hint" style="margin-top:-6px;margin-bottom:16px">Einmalig ca. 5 Minuten. Danach startet der Time Tracker wie eine normale App vom Home-Bildschirm.</p>

    <div class="card">
      <h3 style="margin-top:0">Das brauchst du</h3>
      <ul class="steps">
        <li>Ein iPhone mit aktuellem iOS und <b>Safari</b>. Andere Browser können keine Apps zum Home-Bildschirm hinzufügen.</li>
        <li>Ein <b>Dropbox-Konto</b>. Noch keins? ${link('https://www.dropbox.com/register', 'Kostenlos registrieren')}</li>
        <li>Optional die ${link('https://apps.apple.com/app/dropbox/id327630330', 'Dropbox-App aus dem App Store')}, damit du dich schneller anmelden kannst.</li>
      </ul>
    </div>

    ${step(1, 'Time Tracker in Safari öffnen', `
      <p>Öffne auf dem iPhone in <b>Safari</b> diese Adresse:</p>
      <p><code>${APP_URL}</code></p>
      <div class="actions">
        <button class="btn small" data-act="copy">Link kopieren</button>
        ${navigator.share ? '<button class="btn small" data-act="share">Link senden …</button>' : ''}
      </div>
      <p class="hint">Tipp: Am Mac mit „Link senden …“ per AirDrop oder Nachricht direkt aufs iPhone schicken.</p>`)}

    ${step(2, 'Zum Home-Bildschirm hinzufügen', `
      <ol class="steps">
        <li>Unten in Safari auf das <b>Teilen-Symbol</b> tippen (Quadrat mit Pfeil nach oben). Bei manchen iOS-Versionen erst auf <b>•••</b> tippen.</li>
        <li>Nach unten scrollen und <b>Zum Home-Bildschirm</b> wählen.</li>
        <li>Prüfen, dass <b>Als Web-App öffnen</b> eingeschaltet ist (falls angezeigt), dann <b>Hinzufügen</b> tippen.</li>
      </ol>
      <p class="hint">Auf dem Home-Bildschirm erscheint jetzt das Hip-Gun-Symbol „Time Tracker“.</p>`)}

    ${step(3, 'App vom Home-Bildschirm starten', `
      <p>Ab jetzt die App <b>immer über das Symbol</b> auf dem Home-Bildschirm öffnen, nicht über den Safari-Tab. Die installierte App hat ihren eigenen Speicher und ihre eigene Dropbox-Verbindung.</p>`)}

    ${step(4, 'Mit Dropbox verbinden', `
      <ol class="steps">
        <li>In der App unten auf <b>Einstellungen</b> tippen.</li>
        <li><b>Code bei Dropbox holen</b> tippen. Es öffnet sich die Dropbox-Anmeldung.</li>
        <li>Bei Dropbox anmelden. Bei der Warnung „Bevor Sie diese App verknüpfen …“ auf <b>Weiter</b> tippen.</li>
        <li>Auf <b>Zulassen</b> tippen. Die App speichert ihre Daten ausschließlich im Ordner <b>Studio › Time Tracker › data</b>.</li>
        <li>Dropbox zeigt einen <b>Zugriffscode</b>. Den Code kopieren (lange drücken → Kopieren).</li>
        <li>Das Dropbox-Fenster schließen (<b>Fertig</b> oben links) bzw. zurück zur Time-Tracker-App wechseln.</li>
        <li>Den Code in das Feld <b>Code einfügen</b> einsetzen und auf <b>Bestätigen</b> tippen.</li>
      </ol>
      <p class="hint">Der Code gilt nur wenige Minuten und nur einmal. Bei „Anmeldung abgelaufen“ einfach nochmal bei Schritt 2 beginnen.</p>`)}

    ${step(5, 'Fertig, kurz prüfen', `
      <p>Oben rechts steht jetzt <span class="badge">Synchronisiert</span>. Kunden und Einträge, die bereits auf einem anderen Gerät erfasst wurden, erscheinen nach wenigen Sekunden.</p>
      <p class="hint">Die Daten liegen als <code>time-tracker.json</code> im Ordner <b>Dropbox › Studio › Time Tracker › data</b>.</p>`)}

    <div class="card">
      <h3 style="margin-top:0">Gut zu wissen</h3>
      <ul class="steps">
        <li><b>Offline:</b> Einträge lassen sich auch ohne Netz erfassen. Oben steht dann „Offline · Änderungen warten“. Sobald wieder Netz da ist, wird automatisch synchronisiert.</li>
        <li><b>Stundenzettel aufs iPhone:</b> Unter „Stundenzettel“ auf <b>PDF erstellen</b> tippen. Im Teilen-Menü <b>In Dateien sichern</b>, Mail oder AirDrop wählen.</li>
        <li><b>Updates:</b> Neue Versionen kommen automatisch. Falls etwas veraltet wirkt, die App ganz schließen (vom unteren Rand hochwischen) und neu öffnen.</li>
        <li><b>Sync-Fehler:</b> Auf die Statusanzeige oben rechts tippen. Hilft das nicht, unter Einstellungen <b>Trennen</b> und die Schritte 4–5 wiederholen.</li>
        <li><b>Zugriff entziehen:</b> Jederzeit unter ${link('https://www.dropbox.com/account/connected_apps', 'Dropbox › Verknüpfte Apps')} möglich.</li>
        <li><b>Andere Personen:</b> Wer die App mit seinem eigenen Dropbox-Konto verbindet, arbeitet mit seinen eigenen, getrennten Daten. Es werden keine Daten zwischen verschiedenen Dropbox-Konten geteilt.</li>
      </ul>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Und am Mac?</h3>
      <p style="margin:0">Einfach ${link(APP_URL, 'die App-Adresse')} in Safari oder Chrome öffnen, unter Einstellungen auf <b>Mit Dropbox verbinden</b> klicken und zulassen. In Safari kannst du sie über <b>Ablage › Zum Dock hinzufügen</b> auch als eigene App ins Dock legen.</p>
    </div>`;

  root.addEventListener('click', async e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'copy') {
      try {
        await navigator.clipboard.writeText(APP_URL);
        toast('Link kopiert');
      } catch {
        toast(APP_URL);
      }
    } else if (t.dataset.act === 'share') {
      navigator.share({ title: 'Hip Gun Time Tracker', url: APP_URL }).catch(() => {});
    }
  });
}

// ---------- Navigation ----------
const views = {
  erfassen: viewErfassen,
  kunden: viewKunden,
  pdf: viewPdf,
  einstellungen: viewEinstellungen,
  anleitung: viewAnleitung,
};

// Unterseiten ohne eigenen Tab markieren ihren Eltern-Tab
const parentTab = { anleitung: 'einstellungen' };

let current = null;

// Ohne Dropbox-Verbindung bleiben Daten nur in diesem Browser – das soll niemand übersehen
function connectBanner() {
  if (dbx.isConnected()) return null;
  const el = document.createElement('a');
  el.href = '#einstellungen';
  el.className = 'card banner';
  el.innerHTML = '<b>Nicht mit Dropbox verbunden.</b> Einträge werden nur in diesem Browser gespeichert und nicht mit anderen Geräten abgeglichen. <u>Jetzt verbinden</u>';
  return el;
}

function show(name) {
  if (!views[name]) name = 'erfassen';
  if (name !== 'erfassen') { draft.editingId = null; draft.returnTo = null; }
  // Frischer Container, damit keine Event-Listener der vorigen Ansicht hängen bleiben
  const root = document.createElement('div');
  const banner = name === 'einstellungen' || name === 'anleitung' ? null : connectBanner();
  main.replaceChildren(...(banner ? [banner] : []), root);
  current = { name, update: views[name](root) };
  const tab = parentTab[name] || name;
  tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.view === tab));
  if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
}

addEventListener('hashchange', () => {
  if (location.hash.slice(1) !== current?.name) show(location.hash.slice(1));
});

tabs.addEventListener('click', e => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  if (b.dataset.view === 'pdf') {
    Object.assign(pdfUI, { clientId: lastEnteredClientId(), open: null });
  }
  show(b.dataset.view);
  scrollTo({ top: 0 });
});

// ---------- Sync-Steuerung ----------
function updatePill() {
  const { status } = dbx.syncState;
  let state = 'ok', label = 'Synchronisiert';
  if (!dbx.isConnected()) { state = 'none'; label = 'Nicht verbunden'; }
  else if (status === 'busy') { state = 'busy'; label = 'Synchronisiere …'; }
  else if (status === 'offline') { state = 'pending'; label = store.dirty ? 'Offline · Änderungen warten' : 'Offline'; }
  else if (status === 'error') { state = 'error'; label = 'Sync-Fehler'; }
  else if (store.dirty) { state = 'pending'; label = 'Änderungen warten'; }
  else if (status === 'idle') { label = 'Verbunden'; }
  pill.dataset.state = state;
  pill.querySelector('.label').textContent = label;
  pill.title = dbx.syncState.error || 'Jetzt synchronisieren';
}

pill.addEventListener('click', () => {
  if (!dbx.isConnected() || dbx.syncState.status === 'error') show('einstellungen');
  if (dbx.isConnected()) dbx.sync();
});

let syncTimer;
store.subscribe(() => {
  current?.update?.();
  updatePill();
  if (store.dirty && dbx.isConnected()) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => dbx.sync(), 1500);
  }
});

dbx.onSyncChange(() => {
  // Erst nach dem Abgleich festschreiben, damit nichts Neueres von anderen Geräten überschrieben wird
  if (dbx.syncState.status === 'ok') migratePrices();
  updatePill();
  if (current?.name === 'einstellungen') current.update();
});

addEventListener('online', () => dbx.sync());
addEventListener('offline', () => { dbx.syncState.status = 'offline'; updatePill(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') dbx.sync();
});
setInterval(() => { if (document.visibilityState === 'visible') dbx.sync(); }, 2 * 60 * 1000);

// ---------- Start ----------
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker', err));
}

// Beim Start immer mit der Erfassung beginnen
if (!dbx.isConnected()) migratePrices();
show('erfassen');
updatePill();
window.__appReady = true;

dbx.handleRedirect()
  .then(connected => {
    if (connected) {
      toast('Mit Dropbox verbunden');
      show('einstellungen');
    }
  })
  .catch(err => toast(err.message))
  .finally(() => dbx.sync());
