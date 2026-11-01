// Stundenzettel als PDF (A4). Kopf nur mit Logo, Beträge netto (zzgl. MwSt.).
import { fmtHours, fmtDays, fmtDate, fmtMoney, todayISO } from './format.js';
import { KINDS, entryKind, entryAmount, usedRatesLabel, entryEndDate } from './rates.js';

let logoCache = null;

async function loadLogo() {
  if (logoCache) return logoCache;
  const img = new Image();
  img.src = 'assets/logo.png';
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  logoCache = { data: canvas.toDataURL('image/png'), ratio: img.naturalHeight / img.naturalWidth };
  return logoCache;
}

// groups: [{ name: string|null, entries: [{date, hours, kind, description}] }]
export async function buildTimesheet({ clientName, from, to, groups }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = 210, M = 20, BOTTOM = 272;
  const colDate = M, colKind = M + 23, colDesc = M + 39, colHours = W - M - 30, colAmount = W - M;
  const descWidth = colHours - colDesc - 14;
  const ink = [29, 29, 27], muted = [110, 110, 104], line = [215, 215, 208], accent = [162, 197, 22];

  // Kopf
  const logo = await loadLogo();
  const logoW = 38;
  doc.addImage(logo.data, 'PNG', W - M - logoW, 14, logoW, logoW * logo.ratio, 'logo', 'FAST');

  doc.setTextColor(...ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('Stundenzettel', M, 26);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...muted);
  doc.text('Kunde', M, 38);
  doc.text('Zeitraum', M, 46);
  doc.setTextColor(...ink);
  doc.setFont('helvetica', 'bold');
  doc.text(clientName, M + 22, 38);
  doc.setFont('helvetica', 'normal');
  doc.text(periodLabel(from, to), M + 22, 46);

  let y = 62;

  const tableHead = () => {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...muted);
    doc.text('DATUM', colDate, y);
    doc.text('ART', colKind, y);
    doc.text('TÄTIGKEIT', colDesc, y);
    doc.text('STUNDEN', colHours, y, { align: 'right' });
    doc.text('BETRAG', colAmount, y, { align: 'right' });
    y += 2.5;
    doc.setDrawColor(...ink);
    doc.setLineWidth(0.4);
    doc.line(M, y, W - M, y);
    y += 6;
    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
  };

  const ensureSpace = (needed) => {
    if (y + needed <= BOTTOM) return;
    doc.addPage();
    y = 22;
    tableHead();
  };

  tableHead();

  const showGroupHeads = groups.some(g => g.name);
  let total = 0, totalMoney = 0;

  for (const group of groups) {
    let sum = 0, sumMoney = 0;

    if (showGroupHeads) {
      ensureSpace(14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(group.name || 'Ohne Projekt', M, y);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      y += 6;
    }

    for (const e of group.entries) {
      const amount = entryAmount(e);
      sum += e.hours;
      sumMoney += amount;
      const lines = doc.splitTextToSize(e.description || '–', descWidth);
      // Mehrtägige Einträge: Zeitraum zweizeilig in der Datumsspalte
      const end = entryEndDate(e);
      const multiDay = end !== e.date;
      const dateLines = multiDay ? [fmtDate(e.date), '– ' + fmtDate(end)] : [fmtDate(e.date)];
      const h = Math.max(lines.length, dateLines.length) * 4.6 + 2.4;
      ensureSpace(h);
      doc.text(dateLines, colDate, y, { lineHeightFactor: 1.15 });
      doc.text(KINDS[entryKind(e)], colKind, y);
      doc.text(lines, colDesc, y, { lineHeightFactor: 1.15 });
      doc.text(fmtHours(e.hours), colHours, y, { align: 'right' });
      if (multiDay) {
        // Tagesanzahl klein unter den Stunden
        doc.setFontSize(8.5);
        doc.setTextColor(...muted);
        doc.text(fmtDays(e.hours), colHours, y + 4.6, { align: 'right' });
        doc.setFontSize(10);
        doc.setTextColor(...ink);
      }
      doc.text(fmtMoney(amount), colAmount, y, { align: 'right' });
      y += h;
      doc.setDrawColor(...line);
      doc.setLineWidth(0.2);
      doc.line(M, y - 3.6, W - M, y - 3.6);
    }
    total += sum;
    totalMoney += sumMoney;

    if (showGroupHeads) {
      ensureSpace(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Summe ' + (group.name || 'ohne Projekt'), colDesc, y);
      doc.text(fmtHours(sum), colHours, y, { align: 'right' });
      doc.text(fmtMoney(sumMoney), colAmount, y, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      y += 9;
    }
  }

  // Gesamtsumme
  ensureSpace(26);
  y += 2;
  doc.setFillColor(...accent);
  doc.rect(M, y - 6, W - 2 * M, 12, 'F');
  doc.setTextColor(29, 29, 27);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Gesamt', M + 4, y + 1.6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`${fmtHours(total)} Std. (${fmtDays(total)})`, colHours, y + 1.6, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(fmtMoney(totalMoney), colAmount - 3, y + 1.6, { align: 'right' });

  y += 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...muted);
  doc.text('Alle Beträge netto, zzgl. gesetzlicher MwSt.', M, y);
  const allEntries = groups.flatMap(g => g.entries);
  doc.text(doc.splitTextToSize(`Tagessätze: ${usedRatesLabel(allEntries)} · Teiltage anteilig (1 Tag = 8 Std.)`, W - 2 * M), M, y + 4.5);

  // Fußzeile
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text('Erstellt am ' + fmtDate(todayISO()), M, 288);
    doc.text(`Seite ${i} / ${pages}`, W - M, 288, { align: 'right' });
  }

  return doc;
}

function periodLabel(from, to) {
  if (from && to) return `${fmtDate(from)} – ${fmtDate(to)}`;
  if (from) return `ab ${fmtDate(from)}`;
  if (to) return `bis ${fmtDate(to)}`;
  return 'Gesamter Zeitraum';
}

// Auf dem iPhone über das Teilen-Menü (Sichern in Dateien, AirDrop, Mail …),
// auf dem Mac als normaler Download.
export async function deliverPdf(doc, filename) {
  const blob = doc.output('blob');
  const file = new File([blob], filename, { type: 'application/pdf' });
  const isTouch = matchMedia('(pointer: coarse)').matches;
  if (isTouch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
