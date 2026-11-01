// Standardwerte. Beide lassen sich in der App unter „Einstellungen“ überschreiben.
// Der App Key ist nicht geheim (PKCE-Verfahren, kein App Secret).
export const CONFIG = {
  // Dropbox-App mit Access type „Full Dropbox“, damit die Daten im Projektordner liegen
  dropboxAppKey: '2f7ccxlefgehb4g',
  // Projektordner in der Dropbox; data/ ist per .gitignore vom öffentlichen Repo ausgeschlossen
  dataPath: '/Studio/Time Tracker/data/time-tracker.json',
};
