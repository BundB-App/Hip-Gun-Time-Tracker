# Time Tracker – Spezifikation

Stand: 01.11.2026 · Ergebnis des Anforderungs-Interviews, ergänzt um Tagessätze und Jahreskalender

## 1. Zweck & Rahmen

- **Ein Nutzer** (nur ich), kein Login-/Rechtesystem in der App selbst.
- Zweck: Arbeitszeit **pro Kunde** festhalten, summieren und als **Stundenzettel-PDF** ausgeben.
- **Beträge über Tagessätze** (Ton/Video, siehe 3a). Keine Rechnungen, keine Auswertungen/Dashboards.
- Bedienbar von allen Macs und vom iPhone mit gleichem Datenstand.

## 2. Datenstruktur

```
Kunde
 └─ Projekt (Pflicht, mind. eins pro Kunde)
     └─ Eintrag
```

### Kunde
| Feld | Typ | Hinweis |
|---|---|---|
| id | string | |
| name | string | |
| archived | bool | inaktive Kunden ausblenden (bei 10–50 Kunden sinnvoll) |
| rates | {ton, video} | aktueller Preis des Kunden, beim Anlegen = Voreinstellung |

### Projekt
| Feld | Typ | Hinweis |
|---|---|---|
| id | string | |
| clientId | string | gehört zu diesem Kunden |
| name | string | |
| archived | bool | |
| rates | {ton, video} | Preis des Projekts, beim Anlegen = damalige Voreinstellung |

Alle Datensätze (Kunde, Projekt, Eintrag, Einstellung) tragen `updatedAt` und ggf. `deleted` für den Sync.

### Eintrag
| Feld | Typ | Hinweis |
|---|---|---|
| id | string | |
| date | YYYY-MM-DD | Pflicht |
| clientId | string | Pflicht |
| projectId | string \| null | optional |
| kind | 'ton' \| 'video' | fehlt bei Alteinträgen → gilt als Ton |
| rates | {weekday, weekend} | beim Erfassen festgeschriebener Tagessatz der Art |
| hours | number | in 0,5-Schritten, gespeichert immer in Stunden |
| description | string | „was gemacht wurde“, erscheint im PDF |
| updatedAt / deleted | Zeitstempel / bool | für Offline-Sync & Konfliktauflösung |

### Einstellung
`settings`-Datensatz mit `id: 'rates'` und der Voreinstellung der Tagessätze `{ ton: {weekday, weekend}, video: {weekday, weekend} }`. Wird wie alle Daten über Dropbox synchronisiert.

## 3. Regeln

- **Erfassung nur manuell** (kein Live-Timer): Datum + Art (Ton/Video) + Dauer + Beschreibung.
- Dauer wahlweise in **Stunden** oder **Tagen** eingeben. **1 Tag = 8 Std.**
- **Rundung auf 30 Minuten** (0,5 Std.).
- Summen werden in Stunden angezeigt, zusätzlich in Tagen (Std. ÷ 8).
- **Jeder Eintrag gehört zu einem Projekt.** Beim Anlegen eines Kunden wird sofort ein erstes Projekt angelegt (Name abgefragt, Vorschlag „Projekt 1“). Projektnamen sind auf der Kunden-Seite jederzeit änderbar.
- Beim Erfassen ist das zuletzt verwendete Projekt des Kunden vorausgewählt.
- **Startseite:** Die App öffnet immer mit „Erfassen“. Vorausgewählt: Kunde, Projekt und Art (Ton/Video) des zuletzt erfassten Eintrags.
- **Menü:** Erfassen · Stundenzettel · Kunden · Einstellungen. Einträge werden über Stundenzettel, Kalender oder „Zuletzt erfasst“ bearbeitet.
- **Stundenzettel:** Beim Öffnen über den Tab ist der Kunde des zuletzt erfassten Eintrags gewählt, Zeitraum „Alles“.

## 3a. Tagessätze & Beträge

**Voreinstellung** (in den Einstellungen änderbar):

| Art | Mo–Fr | Sa+So |
|---|---|---|
| Ton | 300 € | 350 € |
| Video | 400 € | 400 € |

**Preise werden festgeschrieben, nie rückwirkend geändert:**
- **Neuer Kunde** und **neues Projekt** (auch bei einem bestehenden Kunden) bekommen beim Anlegen die *aktuelle* Voreinstellung als eigenen Preis.
- Eine spätere Änderung der Voreinstellung betrifft nur danach angelegte Kunden und Projekte. Bestehende Projekte behalten ihren Preis.
- **Preis für neue Einträge:** Projektpreis → sonst Kundenpreis.
- **Beim Erfassen** stehen die Preise unter „Ton“/„Video“ und sind editierbar. Ein geänderter Preis wird beim Speichern ohne Rückfrage der neue Preis des Kunden bzw. Projekts und gilt, bis wieder ein anderer bestimmt wird.
- Auf der Kunden-Seite sind Kunden- und Projektpreise direkt änderbar.
- **Jeder Eintrag speichert seinen Preis** (`rates`). Bearbeiten eines alten Eintrags ändert nur diesen Eintrag.
- **Nachvollziehbarkeit:** Die Kunden-Seite zeigt „Abgerechnete Preise“ (Art, Satz, Projekt, Zeitraum, Anzahl Einträge). Das PDF nennt die tatsächlich verwendeten Sätze.
- **Teiltage anteilig:** Betrag = Stunden ÷ 8 × Tagessatz des jeweiligen Wochentags.
- Beträge netto, im PDF mit „zzgl. MwSt.“.
- Daten von vor dieser Regel (ohne Preis) bekommen einmalig die Voreinstellung 300/350/400 fest eingetragen.

## 3b. Jahreskalender

- 12 Monate eines Jahres, gearbeitete Tage farbig: Ton grün, Video blau, beides geteilt. Jahr umschaltbar.
- Aufrufbar auf der Kunden-Seite (alle Kunden mit Filter und pro Kunde) und auf der Stundenzettel-Seite.
- Tag antippen zeigt die Einträge, Eintrag antippen öffnet ihn zum Bearbeiten.
- Im Stundenzettel übernimmt ein Klick auf den Monatsnamen den Monat als Zeitraum.

## 4. Stundenzettel-PDF (pro Kunde)

- Kopf: **nur Logo** (`Stuff/logo.png`), keine Firmendaten.
- Kundenname, Zeitraum.
- Tabelle: Datum · Art · Beschreibung · Stunden · Betrag, falls vorhanden **gruppiert nach Projekt** mit Zwischensumme.
- Gesamtsumme in Stunden (und Tagen) und Euro, Hinweis „zzgl. MwSt.“ und verwendete Tagessätze.
- Kein Unterschriftsfeld.

## 5. Technik

- **Web-App / PWA**: HTML, CSS, JS, ohne Build-Schritt. Auf dem iPhone über „Zum Home-Bildschirm“ installierbar.
- **Code** liegt in diesem Dropbox-Ordner und ist ein Git-Repo, gepusht in ein **öffentliches GitHub-Repo**.
- **Repo:** https://github.com/BundB-App/Hip-Gun-Time-Tracker (öffentlich)
- **Hosting:** GitHub Pages unter `https://bundb-app.github.io/Hip-Gun-Time-Tracker/`. Eine URL für Mac und iPhone.
- **Daten:** eine JSON-Datei in der Dropbox, gelesen und geschrieben über die Dropbox-API (OAuth mit PKCE, nur App Key, kein Secret im Code).
- **Offline:** Service Worker cacht die App. Einträge werden lokal (IndexedDB/localStorage) gepuffert und bei Netz synchronisiert. Merge pro Datensatz über `updatedAt`, Löschungen als Tombstones.
- Im öffentlichen Repo liegen **keine Daten** und keine Secrets.
- Oberfläche auf Deutsch.

## 6. Dropbox-App: Einstellungen prüfen

Unter https://www.dropbox.com/developers/apps → deine App:

1. **Settings → Access type:** „App folder“ empfohlen. Die Daten landen dann in `Dropbox/Apps/<App-Name>/`.
   Hinweis: Diese Einstellung lässt sich nachträglich nicht ändern. Bei „Full Dropbox“ legen wir einen festen Pfad fest.
2. **Settings → OAuth 2 → Redirect URIs:** eintragen
   - `https://bundb-app.github.io/Hip-Gun-Time-Tracker/` (Groß-/Kleinschreibung im Pfad beachten)
   - `http://localhost:8000/` (für lokale Tests)
3. **Settings → Allow public clients (Implicit Grant & PKCE):** auf **Allow**.
4. **Permissions:** `files.content.read` und `files.content.write` anhaken → **Submit**.
   (`files.metadata.read` ist automatisch dabei.)
5. **App key** (Settings-Seite) notieren. Er ist nicht geheim und kommt in die Konfiguration der App.
   Das **App secret** wird **nicht** benötigt und darf nicht ins Repo.

## 7. Status

- Dropbox-App eingerichtet (Access type „App folder“), App Key in `js/config.js` hinterlegt.
- Daten: `Dropbox/Apps/Hip Gun Time Tracker/time-tracker.json`
