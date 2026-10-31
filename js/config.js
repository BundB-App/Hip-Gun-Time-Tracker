// Standardwerte. Beide lassen sich in der App unter „Einstellungen“ überschreiben.
// Der App Key ist nicht geheim (PKCE-Verfahren, kein App Secret).
export const CONFIG = {
  dropboxAppKey: '',
  // Bei Access type „App folder“ liegt die Datei in Dropbox/Apps/<App-Name>/
  dataPath: '/time-tracker.json',
};
