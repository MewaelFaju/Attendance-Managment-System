// Weekly / monthly attendance reports as Excel, Word and PDF files.
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const docx = require('docx');

const COMPANY = 'Med Tech Com Trading';
const ETH_MONTHS = ['Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit', 'Megabit', 'Miazia', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume'];
const G_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

function gregorianToEthiopian(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  const jdn =
    d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  const r = (jdn - 1723856) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  return {
    y: 4 * Math.floor((jdn - 1723856) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460),
    m: Math.floor(n / 30) + 1,
    d: (n % 30) + 1,
  };
}

const ethDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const e = gregorianToEthiopian(y, m, d);
  return `${ETH_MONTHS[e.m - 1]} ${e.d}, ${e.y}`;
};
const gregDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${G_MONTHS[m - 1]} ${d}, ${y}`;
};

// Ethiopian clock (day starts at our 06:00); AM = daytime half. Followed by the 24-hour time.
function clock(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const h = d.getHours();
  const eth = `${(h + 6) % 12 || 12}:${pad(d.getMinutes())} ${h >= 6 && h < 18 ? 'AM' : 'PM'}`;
  return `${eth} (${pad(h)}:${pad(d.getMinutes())})`;
}

const hoursText = (h) => (h == null ? '—' : h.toFixed(2));
const round2 = (n) => Math.round(n * 100) / 100;

// `employees`: [{id, name}], `records`: serialized attendance records, oldest first.
function buildReport({ title, from, to, employees, records, generatedAt }) {
  const per = new Map(employees.map((e) => [e.id, { name: e.name, onTime: 0, late: 0, early: 0, hours: 0, closed: 0 }]));
  for (const r of records) {
    const row = per.get(r.employeeId);
    if (!row) continue;
    if (r.status === 'late') row.late += 1;
    else row.onTime += 1;
    if (r.earlyLeave) row.early += 1;
    if (r.hours != null) {
      row.hours += r.hours;
      row.closed += 1;
    }
  }
  const people = [...per.values()].sort((a, b) => a.name.localeCompare(b.name));
  const closed = records.filter((r) => r.hours != null);
  const average = closed.length ? closed.reduce((s, r) => s + r.hours, 0) / closed.length : 0;
  const late = records.filter((r) => r.status === 'late').length;

  return {
    company: COMPANY,
    title: 'Employees Attendance Report',
    period: title,
    range: `${ethDate(from)} – ${ethDate(to)}  (${gregDate(from)} – ${gregDate(to)})`,
    generated: `Generated ${gregDate(generatedAt.slice(0, 10))} ${clock(generatedAt)}`,
    summary: [
      ['Employees', employees.length],
      ['Total check-ins', records.length],
      ['On time', records.length - late],
      ['Late', late],
      ['Average hours / day', hoursText(round2(average))],
    ],
    peopleHeaders: ['Employee', 'Days present', 'On time', 'Late', 'Left early', 'Total hours', 'Avg. hours / day'],
    peopleRows: people.map((p) => [
      p.name,
      p.onTime + p.late,
      p.onTime,
      p.late,
      p.early,
      hoursText(round2(p.hours)),
      p.closed ? hoursText(round2(p.hours / p.closed)) : '—',
    ]),
    recordHeaders: ['Employee', 'Date (Ethiopian)', 'Date (Gregorian)', 'Check In', 'Check Out', 'Hours', 'Status'],
    recordRows: records.map((r) => [
      r.employeeName,
      ethDate(r.date),
      gregDate(r.date),
      clock(r.checkIn),
      clock(r.checkOut),
      hoursText(r.hours),
      r.earlyLeave ? `${r.status} (left early)` : r.status,
    ]),
  };
}

/* ---------------- Excel ---------------- */

async function toXlsx(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY;
  const style = (row) => {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  };

  const sum = wb.addWorksheet('Summary');
  sum.addRow([`${report.company} — ${report.title}`]).font = { bold: true, size: 14 };
  sum.addRow([report.period]).font = { bold: true };
  sum.addRow([report.range]);
  sum.addRow([report.generated]);
  sum.addRow([]);
  for (const [label, value] of report.summary) sum.addRow([label, value]).getCell(1).font = { bold: true };
  sum.addRow([]);
  style(sum.addRow(report.peopleHeaders));
  for (const row of report.peopleRows) sum.addRow(row);
  sum.columns.forEach((c, i) => {
    c.width = i === 0 ? 30 : 18;
  });

  const rec = wb.addWorksheet('Records');
  style(rec.addRow(report.recordHeaders));
  for (const row of report.recordRows) rec.addRow(row);
  rec.columns.forEach((c, i) => {
    c.width = [28, 20, 18, 22, 22, 9, 22][i];
  });
  rec.views = [{ state: 'frozen', ySplit: 1 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ---------------- Word ---------------- */

async function toDocx(report) {
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, ShadingType, HeadingLevel, PageOrientation } = docx;
  const cell = (text, header = false) =>
    new TableCell({
      shading: header ? { type: ShadingType.CLEAR, fill: '4F46E5', color: 'auto' } : undefined,
      children: [
        new Paragraph({
          children: [new TextRun({ text: String(text), bold: header, color: header ? 'FFFFFF' : undefined, size: 18 })],
        }),
      ],
    });
  const table = (headers, rows) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: headers.map((h) => cell(h, true)) }),
        ...rows.map((r) => new TableRow({ children: r.map((c) => cell(c)) })),
      ],
    });

  const doc = new Document({
    creator: COMPANY,
    title: `${report.title} — ${report.period}`,
    sections: [
      {
        properties: { page: { size: { orientation: PageOrientation.LANDSCAPE } } },
        children: [
          new Paragraph({ text: report.company, heading: HeadingLevel.TITLE }),
          new Paragraph({ text: `${report.title} — ${report.period}`, heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: report.range }),
          new Paragraph({ text: report.generated, spacing: { after: 200 } }),
          new Paragraph({ text: 'Summary', heading: HeadingLevel.HEADING_2 }),
          ...report.summary.map(
            ([label, value]) =>
              new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(String(value))] }),
          ),
          new Paragraph({ text: 'By employee', heading: HeadingLevel.HEADING_2, spacing: { before: 240 } }),
          table(report.peopleHeaders, report.peopleRows),
          new Paragraph({ text: 'Daily records', heading: HeadingLevel.HEADING_2, spacing: { before: 240 } }),
          report.recordRows.length
            ? table(report.recordHeaders, report.recordRows)
            : new Paragraph({ text: 'No attendance records in this period.' }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/* ---------------- PDF ---------------- */

function toPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: `${report.title} — ${report.period}`, Author: COMPANY } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;

    const drawTable = (headers, rows, weights) => {
      const total = weights.reduce((a, b) => a + b, 0);
      const cols = weights.map((w) => (w / total) * width);
      const rowHeight = (cells, bold) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
        return Math.max(...cells.map((c, i) => doc.heightOfString(String(c), { width: cols[i] - 8 }))) + 8;
      };
      const drawRow = (cells, header, shade) => {
        const h = rowHeight(cells, header);
        if (doc.y + h > bottom()) {
          doc.addPage();
          drawRow(headers, true, false);
        }
        const y = doc.y;
        if (header) doc.rect(left, y, width, h).fill('#4F46E5');
        else if (shade) doc.rect(left, y, width, h).fill('#F3F4F6');
        doc.fillColor(header ? '#FFFFFF' : '#111827').font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
        let x = left;
        cells.forEach((c, i) => {
          doc.text(String(c), x + 4, y + 4, { width: cols[i] - 8, lineBreak: true });
          x += cols[i];
        });
        doc.y = y + h;
        doc.x = left;
      };
      drawRow(headers, true, false);
      rows.forEach((r, i) => drawRow(r, false, i % 2 === 1));
      doc.fillColor('#111827');
    };

    doc.font('Helvetica-Bold').fontSize(18).text(report.company);
    doc.font('Helvetica-Bold').fontSize(14).text(`${report.title} — ${report.period}`);
    doc.font('Helvetica').fontSize(10).fillColor('#4B5563').text(report.range).text(report.generated).fillColor('#111827');
    doc.moveDown();
    for (const [label, value] of report.summary) {
      doc.font('Helvetica-Bold').fontSize(10).text(`${label}: `, { continued: true }).font('Helvetica').text(String(value));
    }
    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(12).text('By employee').moveDown(0.3);
    drawTable(report.peopleHeaders, report.peopleRows, [3, 1.2, 1, 1, 1.1, 1.3, 1.5]);
    doc.moveDown();
    if (doc.y > bottom() - 60) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(12).text('Daily records').moveDown(0.3);
    if (report.recordRows.length) drawTable(report.recordHeaders, report.recordRows, [3, 2, 2, 2.4, 2.4, 0.9, 2]);
    else doc.font('Helvetica').fontSize(10).text('No attendance records in this period.');
    doc.end();
  });
}

const FORMATS = {
  xlsx: { build: toXlsx, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  docx: { build: toDocx, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pdf: { build: toPdf, type: 'application/pdf' },
};

module.exports = { buildReport, FORMATS, ethDate, gregorianToEthiopian };
