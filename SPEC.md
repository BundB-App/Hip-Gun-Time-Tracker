# Time Tracker – Spezifikation

Stand: 31.10.2026 · Ergebnis des Anforderungs-Interviews

## 1. Zweck & Rahmen

- **Ein Nutzer** (nur ich), kein Login-/Rechtesystem in der App selbst.
- Zweck: Arbeitszeit **pro Kunde** festhalten, summieren und als **Stundenzettel-PDF** ausgeben.
- **Keine** Geldbeträge, keine Stundensätze, keine Rechnungen, keine Auswertungen/Dashboards.
- Bedienbar von allen Macs und vom iPhone mit gleichem Datenstand.

## 2. Datenstruktur

```
Kunde
 └─ Projekt (optional, kommt erst bei Folgeaufträgen dazu)
     └─ Eintrag
```

### Kunde
| Feld | Typ | Hinweis |
|---|---|---|
| id | string | |
| name | string | |
| archived | bool | inaktive Kunden ausblenden (bei 10–50 Kunden sinnvoll) |

### Projekt
| Feld | Typ | Hinweis |
|---|---|---|
| id | string | |
| clientId | string | gehört zu diesem Kunden |
| name | string | |
| archived | bool | |

Alle Datensätze (Kunde, Projekt, Eintrag) tragen `updatedAt` und ggf. `deleted` für den Sync.

### Eintrag
| Feld | Typ | Hinweis |
|---|---|---|
| id | string | |
| date | YYYY-MM-DD | Pflicht |
| clientId | string | Pflicht |
| projectId | string \| null | optional |
| hours | number | in 0,5-Schritten, gespeichert immer in Stunden |
| description | string | „was gemacht wurde“, erscheint im PDF |
| updatedAt / deleted | Zeitstempel / bool | für Offline-Sync & Konfliktauflösung |

## 3. Regeln

- **Erfassung nur manuell** (kein Live-Timer): Datum + Dauer + Beschreibung.
- Dauer wahlweise in **Stunden** oder **Tagen** eingeben. **1 Tag = 8 Std.**
- **Rundung auf 30 Minuten** (0,5 Std.).
- Summen werden in Stunden angezeigt, zusätzlich in Tagen (Std. ÷ 8).
- **Projekte optional pro Eintrag:** Hat ein Kunde Projekte, erscheint ein zweites Auswahlfeld, sonst nicht. Ein Kunde ist mit einem Tippen gewählt.

## 4. Stundenzettel-PDF (pro Kunde)

- Kopf: **nur Logo** (`Stuff/logo.png`), keine Firmendaten.
- Kundenname, Zeitraum.
- Tabelle: Datum · Beschreibung · Stunden, falls vorhanden **gruppiert nach Projekt** mit Zwischensumme.
- Gesamtsumme in Stunden (und Tagen).
- Kein Unterschriftsfeld, keine Beträge.

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

## 7. Offene Punkte vor dem Bau

- Dropbox App Key und gewählter Access type
- Ist `git` / `gh` auf dem Mac eingerichtet? (Der GitHub-Connector konnte sich in dieser Sitzung nicht verbinden.)
