import { store, merge, normalize } from './store.js';
import * as dbx from './dropbox.js';
import { buildTimesheet, deliverPdf } from './pdf.js';
import {
  HOURS_PER_DAY, roundHalf, parseNumber, fmtHours, fmtDays, fmtDate, fmtDateLong, fmtMonth,
  todayISO, monthRange, esc,
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
  const c = store.upsert('clients', { name, archived: false });
  toast(`Kunde „${name}“ angelegt`);
  return c;
}

function createProject(clientId) {
  const name = prompt(`Neues Projekt für ${clientName(clientId)}:`)?.trim();
  if (!name) return null;
  const p = store.upsert('projects', { clientId, name, archived: false });
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

function entryItemHtml(e, { showClient = true, showDate = false } = {}) {
  const proj = e.projectId ? projectName(e.projectId) : '';
  const title = showClient ? esc(clientName(e.clientId)) : '';
  return `
    <button class="list-item" data-edit="${e.id}">
      <div class="main">
        ${title || proj ? `<div class="title">${title} ${proj ? `<span class="badge">${esc(proj)}</span>` : ''}</div>` : ''}
        ${showDate ? `<div class="sub">${fmtDateLong(e.date)}</div>` : ''}
        ${e.description ? `<div class="desc">${esc(e.description)}</div>` : ''}
      </div>
      <div class="hours">${fmtHours(e.hours)} Std.</div>
    </button>`;
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
const draft = { editingId: null, returnTo: null, unit: 'h', date: null, clientId: null, projectId: null };

function viewErfassen(root) {
  const editing = draft.editingId ? store.get('entries', draft.editingId) : null;
  if (!editing) draft.editingId = null;
  let unit = editing ? (editing.unit || 'h') : draft.unit;

  root.innerHTML = `
    <h2>${editing ? 'Eintrag bearbeiten' : 'Zeit erfassen'}</h2>
    <form class="card" id="entry-form" autocomplete="off" novalidate>
      <label class="field"><span>Datum</span><input type="date" name="date" required></label>
      <label class="field"><span>Kunde</span><select name="client"></select></label>
      <div id="project-wrap"></div>
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
      <label class="field"><span>Beschreibung</span><textarea name="description" placeholder="Was wurde gemacht?"></textarea></label>
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

  f.date.value = editing?.date || draft.date || todayISO();
  const initialClient = editing?.clientId || draft.clientId || recentClientIds()[0] || '';
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
    if (current && !projects.includes(current)) projects.push(current);
    if (!clientId) {
      projectWrap.innerHTML = '';
    } else if (projects.length) {
      projectWrap.innerHTML = `
        <label class="field"><span>Projekt</span>
          <select name="project">
            <option value="">Ohne Projekt</option>
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
    const values = unit === 'h' ? [0.5, 1, 2, 3, 4, 6, 8] : [0.5, 1, 2, 3, 5];
    root.querySelector('#chips').innerHTML = values
      .map(v => `<button type="button" class="chip" data-chip="${v}">${fmtHours(v)} ${unit === 'h' ? 'Std.' : (v === 1 ? 'Tag' : 'Tage')}</button>`)
      .join('');
    renderHint();
  }

  function computedHours() {
    const n = parseNumber(f.amount.value);
    if (!(n > 0)) return NaN;
    return roundHalf(unit === 'd' ? n * HOURS_PER_DAY : n);
  }

  function renderHint() {
    const n = parseNumber(f.amount.value);
    const h = computedHours();
    let text = unit === 'd' ? '1 Tag = 8 Std.' : 'Wird auf 30 Minuten gerundet.';
    if (n > 0) {
      if (h === 0) text = 'Mindestens 0,5 Std.';
      else if (unit === 'd') text = `= ${fmtHours(h)} Std.`;
      else if (h !== n) text = `Wird auf ${fmtHours(h)} Std. gerundet.`;
      else text = '';
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
  renderUnit();
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
    }
    if (e.target.name === 'project') {
      if (e.target.value === '__new') {
        const p = createProject(f.client.value);
        projectId = p ? p.id : null;
        renderProject();
      } else {
        projectId = e.target.value || null;
      }
    }
  });

  form.addEventListener('input', e => {
    if (e.target.name === 'amount') renderHint();
  });

  form.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.unit) {
      unit = t.dataset.unit;
      if (!editing) draft.unit = unit;
      renderUnit();
    } else if (t.dataset.chip) {
      f.amount.value = fmtHours(Number(t.dataset.chip));
      renderHint();
    } else if (t.dataset.act === 'add-project') {
      const p = createProject(f.client.value);
      if (p) { projectId = p.id; renderProject(); }
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
    if (!(hours > 0)) return toast('Bitte eine Dauer eingeben (mind. 0,5 Std.)');
    store.upsert('entries', {
      id: editing?.id,
      date: f.date.value,
      clientId,
      projectId: projectId || null,
      hours,
      unit,
      description: f.description.value.trim(),
    });
    toast(`${fmtHours(hours)} Std. für ${clientName(clientId)} gespeichert`);
    if (editing) return leaveEdit();
    draft.date = f.date.value;
    draft.clientId = clientId;
    draft.projectId = projectId;
    f.amount.value = '';
    f.description.value = '';
    renderHint();
  });

  function leaveEdit() {
    const back = draft.returnTo;
    draft.editingId = null;
    draft.returnTo = null;
    show(back || 'erfassen');
  }

  return () => {
    const keepClient = f.client.value;
    renderClients(keepClient);
    renderProject();
    renderRecent();
  };
}

// ---------- Ansicht: Einträge ----------
const listFilter = { month: todayISO().slice(0, 7), clientId: '' };

function viewEintraege(root) {
  root.innerHTML = `
    <h2>Einträge</h2>
    <div class="row" style="margin-bottom:14px">
      <select id="f-month" aria-label="Monat"></select>
      <select id="f-client" aria-label="Kunde"></select>
    </div>
    <div id="entries"></div>`;
  const monthSel = root.querySelector('#f-month');
  const clientSel = root.querySelector('#f-client');

  monthSel.addEventListener('change', () => { listFilter.month = monthSel.value; update(); });
  clientSel.addEventListener('change', () => { listFilter.clientId = clientSel.value; update(); });

  function update() {
    const entries = store.all('entries');
    const months = [...new Set([todayISO().slice(0, 7), ...entries.map(e => e.date.slice(0, 7))])].sort().reverse();
    monthSel.innerHTML = months.map(m => `<option value="${m}">${fmtMonth(m)}</option>`).join('') + '<option value="all">Alle Monate</option>';
    monthSel.value = listFilter.month;
    clientSel.innerHTML = clientOptionsHtml(listFilter.clientId, { placeholder: 'Alle Kunden', includeArchived: true });
    clientSel.value = listFilter.clientId;

    const list = entries
      .filter(e => listFilter.month === 'all' || e.date.startsWith(listFilter.month))
      .filter(e => !listFilter.clientId || e.clientId === listFilter.clientId)
      .sort(sortEntriesDesc);

    const el = root.querySelector('#entries');
    if (!list.length) {
      el.innerHTML = '<div class="empty">Keine Einträge in diesem Zeitraum.</div>';
      return;
    }
    const total = list.reduce((s, e) => s + e.hours, 0);
    let html = `<div class="list"><div class="summary"><span>Summe</span><span class="big">${fmtHours(total)} Std. <span class="hint">(${fmtDays(total)})</span></span></div></div><div class="list">`;
    let day = null;
    for (const e of list) {
      if (e.date !== day) {
        day = e.date;
        const daySum = list.filter(x => x.date === day).reduce((s, x) => s + x.hours, 0);
        html += `<div class="group-head"><span>${fmtDateLong(day)}</span><span>${fmtHours(daySum)} Std.</span></div>`;
      }
      html += entryItemHtml(e, { showClient: !listFilter.clientId });
    }
    el.innerHTML = html + '</div>';
  }

  update();
  return update;
}

// ---------- Ansicht: Kunden ----------
const clientUI = { q: '', showArchived: false, open: null };

function viewKunden(root) {
  root.innerHTML = `
    <h2>Kunden</h2>
    <div class="row" style="margin-bottom:10px">
      <input type="search" id="q" placeholder="Suchen …" value="${esc(clientUI.q)}">
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
            <div class="sub">${own.length} ${own.length === 1 ? 'Eintrag' : 'Einträge'} · ${fmtHours(sum)} Std.${projects.length ? ` · ${projects.length} ${projects.length === 1 ? 'Projekt' : 'Projekte'}` : ''}</div>
          </div>
          <div class="sub">${open ? '▴' : '▾'}</div>
        </button>
        ${open ? `
        <div class="client-detail">
          <h3>Projekte</h3>
          ${projects.map(p => `
            <div class="proj">
              <span class="name">${esc(p.name)} ${p.archived ? '<span class="badge grey">archiviert</span>' : ''}</span>
              <button class="btn small" data-act="proj-rename" data-id="${p.id}">Umbenennen</button>
              <button class="btn small" data-act="proj-archive" data-id="${p.id}">${p.archived ? 'Reaktivieren' : 'Archivieren'}</button>
            </div>`).join('') || '<div class="hint">Noch keine Projekte. Einträge laufen direkt auf den Kunden.</div>'}
          <button class="link" data-act="proj-add" data-id="${c.id}">+ Projekt hinzufügen</button>
          <div class="actions" style="margin-top:12px">
            <button class="btn small" data-act="rename" data-id="${c.id}">Umbenennen</button>
            <button class="btn small" data-act="archive" data-id="${c.id}">${c.archived ? 'Reaktivieren' : 'Archivieren'}</button>
            <button class="btn small danger" data-act="delete" data-id="${c.id}">Löschen</button>
          </div>
        </div>` : ''}`;
    }).join('')}</div>`;
  }

  update();
  return update;
}

// ---------- Ansicht: Stundenzettel ----------
const pdfUI = { clientId: '', projectId: '', ...monthRange(0) };

function timesheetGroups() {
  const entries = store.all('entries')
    .filter(e => e.clientId === pdfUI.clientId)
    .filter(e => !pdfUI.projectId || e.projectId === pdfUI.projectId)
    .filter(e => (!pdfUI.from || e.date >= pdfUI.from) && (!pdfUI.to || e.date <= pdfUI.to))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.updatedAt || 0) - (b.updatedAt || 0));
  const map = new Map();
  for (const e of entries) {
    const key = e.projectId || '';
    if (!map.has(key)) map.set(key, { name: key ? projectName(key) : null, entries: [] });
    map.get(key).entries.push(e);
  }
  return [...map.values()].sort((a, b) => (a.name === null ? -1 : b.name === null ? 1 : a.name.localeCompare(b.name, 'de')));
}

function viewPdf(root) {
  root.innerHTML = `
    <h2>Stundenzettel</h2>
    <div class="card">
      <label class="field"><span>Kunde</span><select id="p-client"></select></label>
      <div id="p-project"></div>
      <div class="field"><span>Zeitraum</span>
        <div class="chips" style="margin:0 0 10px">
          <button class="chip" data-range="this">Dieser Monat</button>
          <button class="chip" data-range="last">Letzter Monat</button>
          <button class="chip" data-range="year">Dieses Jahr</button>
          <button class="chip" data-range="all">Alles</button>
        </div>
        <div class="row">
          <label class="field" style="margin:0"><span>Von</span><input type="date" id="p-from"></label>
          <label class="field" style="margin:0"><span>Bis</span><input type="date" id="p-to"></label>
        </div>
      </div>
    </div>
    <div id="preview"></div>
    <button class="btn primary block" id="make-pdf">PDF erstellen</button>`;

  const clientSel = root.querySelector('#p-client');
  const fromIn = root.querySelector('#p-from');
  const toIn = root.querySelector('#p-to');

  clientSel.addEventListener('change', () => { pdfUI.clientId = clientSel.value; pdfUI.projectId = ''; update(); });
  fromIn.addEventListener('change', () => { pdfUI.from = fromIn.value; update(); });
  toIn.addEventListener('change', () => { pdfUI.to = toIn.value; update(); });
  root.querySelector('#p-project').addEventListener('change', e => { pdfUI.projectId = e.target.value; update(); });

  root.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
    const r = b.dataset.range;
    const y = new Date().getFullYear();
    Object.assign(pdfUI,
      r === 'this' ? monthRange(0)
      : r === 'last' ? monthRange(-1)
      : r === 'year' ? { from: `${y}-01-01`, to: `${y}-12-31` }
      : { from: '', to: '' });
    update();
  }));

  root.querySelector('#make-pdf').addEventListener('click', async () => {
    const groups = timesheetGroups();
    if (!groups.length) return;
    try {
      const name = clientName(pdfUI.clientId);
      const doc = await buildTimesheet({ clientName: name, from: pdfUI.from, to: pdfUI.to, groups });
      const slug = name.replace(/[^\wäöüÄÖÜß-]+/g, '_').replace(/^_|_$/g, '');
      const period = pdfUI.from || pdfUI.to ? `${pdfUI.from || ''}_${pdfUI.to || ''}` : 'gesamt';
      await deliverPdf(doc, `Stundenzettel_${slug}_${period}.pdf`);
    } catch (err) {
      console.error(err);
      toast('PDF konnte nicht erstellt werden');
    }
  });

  function update() {
    clientSel.innerHTML = clientOptionsHtml(pdfUI.clientId, { placeholder: 'Kunde wählen …', includeArchived: true });
    clientSel.value = pdfUI.clientId;
    fromIn.value = pdfUI.from;
    toIn.value = pdfUI.to;

    const projects = pdfUI.clientId ? store.projectsOf(pdfUI.clientId, { includeArchived: true }) : [];
    root.querySelector('#p-project').innerHTML = projects.length ? `
      <label class="field"><span>Projekt</span>
        <select>
          <option value="">Alle Projekte</option>
          ${projects.map(p => `<option value="${p.id}"${p.id === pdfUI.projectId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
      </label>` : '';

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
      preview.innerHTML = '<div class="empty">Keine Einträge für diesen Kunden im gewählten Zeitraum.</div>';
      return;
    }
    const heads = groups.some(g => g.name);
    let total = 0;
    let html = '<div class="list">';
    for (const g of groups) {
      const sum = g.entries.reduce((s, e) => s + e.hours, 0);
      total += sum;
      if (heads) html += `<div class="group-head"><span>${esc(g.name || 'Ohne Projekt')}</span><span>${fmtHours(sum)} Std.</span></div>`;
      html += g.entries.map(e => `
        <button class="list-item" data-edit="${e.id}">
          <div class="sub" style="width:80px;flex:none">${fmtDate(e.date)}</div>
          <div class="main"><div class="desc" style="margin:0">${esc(e.description) || '–'}</div></div>
          <div class="hours">${fmtHours(e.hours)}</div>
        </button>`).join('');
    }
    html += `</div><div class="list"><div class="summary"><span>Gesamt</span><span class="big">${fmtHours(total)} Std. <span class="hint">(${fmtDays(total)})</span></span></div></div>`;
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
        <h3 style="margin-top:0">Daten</h3>
        <p style="margin-top:0">${counts.k} Kunden · ${counts.e} Einträge${store.dirty ? ' · <span class="badge grey">nicht synchronisierte Änderungen</span>' : ''}</p>
        <div class="actions">
          <button class="btn" data-act="export">Backup herunterladen</button>
          <button class="btn" data-act="import">Backup einspielen</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
        </div>
      </div>

      <div class="card">
        <h3 style="margin-top:0">Auf dem iPhone installieren</h3>
        <ol class="steps">
          <li>Diese Seite in <b>Safari</b> öffnen.</li>
          <li>Teilen-Symbol → <b>Zum Home-Bildschirm</b>.</li>
          <li>Die App vom Home-Bildschirm öffnen und hier mit Dropbox verbinden.</li>
        </ol>
        <p class="hint">Die App funktioniert auch offline. Einträge werden synchronisiert, sobald wieder Netz da ist.</p>
      </div>`;
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

// ---------- Navigation ----------
const views = {
  erfassen: viewErfassen,
  eintraege: viewEintraege,
  kunden: viewKunden,
  pdf: viewPdf,
  einstellungen: viewEinstellungen,
};

let current = null;

function show(name) {
  if (!views[name]) name = 'erfassen';
  if (name !== 'erfassen') { draft.editingId = null; draft.returnTo = null; }
  // Frischer Container, damit keine Event-Listener der vorigen Ansicht hängen bleiben
  const root = document.createElement('div');
  main.replaceChildren(root);
  current = { name, update: views[name](root) };
  tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
}

addEventListener('hashchange', () => {
  if (location.hash.slice(1) !== current?.name) show(location.hash.slice(1));
});

tabs.addEventListener('click', e => {
  const b = e.target.closest('button[data-view]');
  if (b) { show(b.dataset.view); scrollTo({ top: 0 }); }
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

show(location.hash.slice(1) || 'erfassen');
updatePill();

dbx.handleRedirect()
  .then(connected => {
    if (connected) {
      toast('Mit Dropbox verbunden');
      show('einstellungen');
    }
  })
  .catch(err => toast(err.message))
  .finally(() => dbx.sync());
