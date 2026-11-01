// Dropbox-Anbindung per OAuth 2 mit PKCE (kein App Secret nötig) und Datei-Sync.
import { CONFIG } from './config.js';
import { store, merge, normalize, emptyDoc } from './store.js';

const SETTINGS_KEY = 'ht.settings';
const AUTH_KEY = 'ht.auth';
const PKCE_KEY = 'ht.pkce';
const LAST_SYNC_KEY = 'ht.lastSync';
// Key der ersten Dropbox-App (Zugriff nur auf Dropbox/Apps/…); Anmeldungen ohne gespeicherten Key stammen von ihr
const LEGACY_APP_KEY = '3v7vqssyf0j853r';

// ---------- Einstellungen ----------
export function getSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch {}
  // Gespeicherte Werte gelten nur, solange die App-Konfiguration dieselbe ist
  if (saved.base !== CONFIG.dropboxAppKey) saved = {};
  return {
    appKey: saved.appKey || CONFIG.dropboxAppKey,
    dataPath: saved.dataPath || CONFIG.dataPath,
  };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch, base: CONFIG.dropboxAppKey };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

function getAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; }
}

function setAuth(auth) {
  if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  else localStorage.removeItem(AUTH_KEY);
}

// Eine Anmeldung gilt nur für die Dropbox-App, mit der sie erstellt wurde
export function isConnected() {
  const auth = getAuth();
  return !!auth?.refresh_token && (auth.appKey || LEGACY_APP_KEY) === getSettings().appKey;
}

export function lastSyncAt() {
  return Number(localStorage.getItem(LAST_SYNC_KEY)) || null;
}

// Muss exakt mit der Redirect URI in der Dropbox-App übereinstimmen.
export function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

// Auf dem iPhone landet ein Redirect aus der Home-Bildschirm-App oft in Safari
// (anderer Speicher). Dort nutzen wir das Code-Verfahren ohne Redirect.
export function prefersCodeFlow() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

// ---------- OAuth ----------
function base64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makePkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

// withRedirect = false: Dropbox zeigt den Code an, der Nutzer fügt ihn in der App ein.
export async function startAuth({ withRedirect }) {
  const { appKey } = getSettings();
  if (!appKey) throw new Error('Bitte zuerst den Dropbox App Key eintragen.');
  // Fenster sofort öffnen, solange der Klick noch zählt (sonst blockt Safari das Popup)
  const popup = withRedirect ? null : window.open('', '_blank');
  const { verifier, challenge } = await makePkce();
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, withRedirect }));

  const params = new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
  });
  if (withRedirect) {
    params.set('redirect_uri', redirectUri());
    params.set('state', state);
  }
  const url = 'https://www.dropbox.com/oauth2/authorize?' + params;
  if (withRedirect) location.href = url;
  else if (popup) popup.location.href = url;
  else location.href = url;
}

async function exchangeCode(code, withRedirect) {
  const pkce = JSON.parse(localStorage.getItem(PKCE_KEY) || 'null');
  if (!pkce) throw new Error('Anmeldung abgelaufen, bitte erneut verbinden.');
  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: getSettings().appKey,
    code_verifier: pkce.verifier,
  });
  if (withRedirect) body.set('redirect_uri', redirectUri());
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || 'Anmeldung bei Dropbox fehlgeschlagen.');
  localStorage.removeItem(PKCE_KEY);
  setAuth({
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + (json.expires_in - 60) * 1000,
    account_id: json.account_id,
    appKey: getSettings().appKey,
  });
}

export function submitManualCode(code) {
  return exchangeCode(code.trim(), false);
}

// Nach dem Redirect von Dropbox: ?code=…&state=… auswerten.
export async function handleRedirect() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return false;
  history.replaceState(null, '', redirectUri());
  if (params.has('error')) throw new Error(params.get('error_description') || 'Dropbox-Anmeldung abgebrochen.');
  const pkce = JSON.parse(localStorage.getItem(PKCE_KEY) || 'null');
  if (!pkce || pkce.state !== params.get('state')) throw new Error('Anmeldung ungültig, bitte erneut verbinden.');
  await exchangeCode(params.get('code'), true);
  return true;
}

export function disconnect() {
  const auth = getAuth();
  setAuth(null);
  if (auth?.access_token) {
    fetch('https://api.dropboxapi.com/2/auth/token/revoke', {
      method: 'POST', headers: { Authorization: 'Bearer ' + auth.access_token },
    }).catch(() => {});
  }
}

async function accessToken(forceRefresh = false) {
  const auth = getAuth();
  if (!isConnected()) throw new Error('Nicht mit Dropbox verbunden.');
  if (!forceRefresh && auth.access_token && Date.now() < auth.expires_at) return auth.access_token;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: auth.refresh_token,
    client_id: getSettings().appKey,
  });
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json.error === 'invalid_grant') setAuth(null);
    throw new Error('Dropbox-Anmeldung abgelaufen, bitte neu verbinden.');
  }
  setAuth({ ...auth, access_token: json.access_token, expires_at: Date.now() + (json.expires_in - 60) * 1000 });
  return json.access_token;
}

// ---------- Datei-API ----------
// Dropbox-API-Arg darf nur ASCII enthalten.
function apiArg(obj) {
  return JSON.stringify(obj).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

async function contentCall(endpoint, arg, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(attempt > 0);
    const headers = { Authorization: 'Bearer ' + token, 'Dropbox-API-Arg': apiArg(arg) };
    if (body !== undefined) headers['Content-Type'] = 'application/octet-stream';
    const res = await fetch('https://content.dropboxapi.com/2/' + endpoint, { method: 'POST', headers, body });
    if (res.status === 401 && attempt === 0) continue;
    return res;
  }
}

async function download(path) {
  const res = await contentCall('files/download', { path });
  if (res.status === 409) {
    const err = await res.json().catch(() => ({}));
    if (JSON.stringify(err).includes('not_found')) return null;
    throw new Error('Dropbox: Datei konnte nicht gelesen werden.');
  }
  if (!res.ok) throw new Error('Dropbox: Download fehlgeschlagen (' + res.status + ').');
  let rev = null;
  try { rev = JSON.parse(res.headers.get('Dropbox-API-Result')).rev; } catch {}
  const text = await res.text();
  let doc;
  try { doc = JSON.parse(text); } catch { throw new Error('Datendatei in der Dropbox ist beschädigt.'); }
  return { doc: normalize(doc), rev };
}

class ConflictError extends Error {}

async function upload(path, doc, rev, exists) {
  let mode = { '.tag': 'overwrite' };
  if (rev) mode = { '.tag': 'update', update: rev };
  else if (!exists) mode = { '.tag': 'add' };
  const res = await contentCall('files/upload', { path, mode, autorename: false, mute: true }, JSON.stringify(doc, null, 1));
  if (res.status === 409) throw new ConflictError();
  if (!res.ok) throw new Error('Dropbox: Upload fehlgeschlagen (' + res.status + ').');
}

// ---------- Sync ----------
const syncListeners = new Set();
export const syncState = { status: 'idle', error: null };

export function onSyncChange(fn) {
  syncListeners.add(fn);
}

function setSync(status, error = null) {
  syncState.status = status;
  syncState.error = error;
  for (const fn of syncListeners) fn();
}

let running = null;

export function sync() {
  if (!running) running = runSync().finally(() => { running = null; });
  return running;
}

async function runSync() {
  if (!isConnected()) return setSync('idle');
  if (!navigator.onLine) return setSync('offline');
  setSync('busy');
  const { dataPath } = getSettings();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const revisionAtStart = store.revision;
      const remote = await download(dataPath);
      const { doc, changedRemote } = merge(store.doc, remote ? remote.doc : emptyDoc());
      try {
        if (changedRemote || !remote) await upload(dataPath, doc, remote?.rev, !!remote);
      } catch (err) {
        if (err instanceof ConflictError) continue; // jemand anderes hat gleichzeitig geschrieben
        throw err;
      }
      store.applySynced(doc, revisionAtStart);
      localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
      setSync('ok');
      if (store.dirty) setTimeout(sync, 500);
      return;
    }
    throw new Error('Sync-Konflikt, bitte erneut versuchen.');
  } catch (err) {
    console.error(err);
    setSync(navigator.onLine ? 'error' : 'offline', err.message);
  }
}
