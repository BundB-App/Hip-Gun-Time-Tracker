// Standardwerte. Beide lassen sich in der App unter „Einstellungen“ überschreiben.
// Der App Key ist nicht geheim (PKCE-Verfahren, kein App Secret).
export const CONFIG = {
  // Dropbox-App mit Access type „Full Dropbox“, damit die Daten im Projektordner liegen
  dropboxAppKey: '2f7ccxlefgehb4g',
  // App-Ordner in der Dropbox (Dropbox/Apps/Time Tracker); data/ ist per .gitignore vom öffentlichen Repo ausgeschlossen
  dataPath: '/Apps/Time Tracker/data/time-tracker.json',
};
