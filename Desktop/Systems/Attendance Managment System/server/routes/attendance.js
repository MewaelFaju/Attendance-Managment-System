const express = require('express');
const { HttpError } = require('../errors');
const { buildReport, FORMATS } = require('../reports');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set(['present', 'late', 'absent', 'permission', 'fieldwork']);
const RECORD_LIMIT = 1000;

// Local (server) calendar date, YYYY-MM-DD.
function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const EXPORT_LIMIT = 50_000;
const FUTURE_TOLERANCE_MS = 60_000;

// Local (server) "YYYY-MM-DD HH:mm" for spreadsheets.
function localDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Quotes CSV cells and neutralises spreadsheet formulas (=, +, -, @) in user-controlled text.
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseInstant(value, label, { required }) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${label} is required`);
    return null;
  }
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isNaN(ms)) throw new HttpError(400, `${label} is not a valid date/time`);
  if (ms > Date.now() + FUTURE_TOLERANCE_MS) throw new HttpError(400, `${label} cannot be in the future`);
  return new Date(ms).toISOString();
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// `endMinutesFor(weekday)` (end of that work day) lets us flag people who left before it.
function serializeRecord(row, endMinutesFor) {
  const [ry, rm, rd] = row.date.split('-').map(Number);
  const endMinutes = endMinutesFor(new Date(ry, rm - 1, rd).getDay());
  const hours =
    row.check_in && row.check_out
      ? Math.round(((Date.parse(row.check_out) - Date.parse(row.check_in)) / 3_600_000) * 100) / 100
      : null;
  let earlyLeave = false;
  if (row.check_out && endMinutes != null) {
    const out = new Date(row.check_out);
    earlyLeave = localDate(out) === row.date && out.getHours() * 60 + out.getMinutes() < endMinutes;
  }
  return {
    earlyLeave,
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.name,
    date: row.date,
    checkIn: row.check_in,
    checkOut: row.check_out,
    hours,
    status: row.status,
  };
}

function createAttendanceRouter({ db, config, authenticate, requireAdmin }) {
  const router = express.Router();
  router.use(authenticate);

  const startMinutes = toMinutes(config.workStart);
  const endMinutesFor = (weekday) => toMinutes(weekday === 6 ? config.workEndSat : config.workEnd);
  const statusAt = (d) => (d.getHours() * 60 + d.getMinutes() > startMinutes ? 'late' : 'present');
  const isWorkday = (d) => config.workDays.includes(d.getDay());
  const toRecord = (row) => serializeRecord(row, endMinutesFor);

  const getEmployee = db.prepare('SELECT id, name FROM employees WHERE id = ?');
  const getRecord = db.prepare(`
    SELECT a.*, e.name FROM attendance a JOIN employees e ON e.id = a.employee_id
    WHERE a.employee_id = ? AND a.date = ?`);

  // Admins act on any employee; employees only on themselves.
  function targetEmployee(req) {
    let id;
    if (req.user.role === 'admin') {
      id = Number(req.body?.employeeId);
      if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'employeeId is required');
    } else {
      id = req.user.employeeId;
      if (!id) throw new HttpError(403, 'Your account is not linked to an employee');
    }
    const employee = getEmployee.get(id);
    if (!employee) throw new HttpError(404, 'Employee not found');
    return employee;
  }

  // Employees are always scoped to themselves, whatever the query says.
  function scopedEmployeeId(req) {
    if (req.user.role !== 'admin') return req.user.employeeId ?? -1;
    if (req.query.employeeId === undefined || req.query.employeeId === 'all') return null;
    const id = Number(req.query.employeeId);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid employeeId');
    return id;
  }

  function dateParam(req, name) {
    const value = req.query[name];
    if (value === undefined || value === '') return null;
    if (typeof value !== 'string' || !DATE_RE.test(value)) {
      throw new HttpError(400, `${name} must be YYYY-MM-DD`);
    }
    return value;
  }

  function findRecords(req, limit = RECORD_LIMIT) {
    // Report filters (status, date range) need admin access or the per-employee "can filter reports" grant.
    const filtered = ['status', 'from', 'to'].some((k) => ![undefined, '', 'all'].includes(req.query[k]));
    if (!req.user.canFilterReports && filtered) {
      throw new HttpError(403, 'You do not have permission to filter reports');
    }
    const employeeId = scopedEmployeeId(req);
    const from = dateParam(req, 'from');
    const to = dateParam(req, 'to');
    const status = req.query.status === undefined || req.query.status === 'all' ? null : req.query.status;
    if (status !== null && !STATUSES.has(status)) throw new HttpError(400, 'Invalid status');

    if (status === 'permission') {
      const today = localDate();
      return db
        .prepare(
          `SELECT e.id, e.name, a.id AS attendance_id, a.date AS attendance_date, a.check_in, a.check_out
           FROM employees e
           LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = ?
           WHERE (? IS NULL OR e.id = ?)
             AND (EXISTS (SELECT 1 FROM permission_requests p
                          WHERE p.employee_id = e.id AND p.date = ? AND p.status = 'approved')
                  OR EXISTS (SELECT 1 FROM permission_days d
                             WHERE d.employee_id = e.id AND d.date = ?))
             AND NOT EXISTS (SELECT 1 FROM fieldwork_days f
                             WHERE f.employee_id = e.id AND f.date = ?)
           ORDER BY e.name COLLATE NOCASE`,
        )
        .all(today, employeeId, employeeId, today, today, today)
        .map((r) =>
          toRecord({
            id: r.attendance_id,
            employee_id: r.id,
            name: r.name,
            date: r.attendance_date || today,
            check_in: r.check_in,
            check_out: r.check_out,
            status: 'permission',
          }),
        );
    }

    if (status === 'fieldwork') {
      const today = localDate();
      return db
        .prepare(
          `SELECT e.id, e.name FROM fieldwork_days f JOIN employees e ON e.id = f.employee_id
           WHERE (? IS NULL OR e.id = ?) AND f.date = ?
           ORDER BY e.name COLLATE NOCASE`,
        )
        .all(employeeId, employeeId, today)
        .map((r) => ({
          id: null,
          employeeId: r.id,
          employeeName: r.name,
          date: today,
          checkIn: null,
          checkOut: null,
          hours: null,
          earlyLeave: false,
          status: 'fieldwork',
        }));
    }

    // "Absent" has no stored rows: it means "no check-in recorded today" (nobody is absent on a day off).
    if (status === 'absent') {
      if (!isWorkday(new Date())) return [];
      const today = localDate();
      const rows = db
        .prepare(
          `SELECT e.id, e.name FROM employees e
           WHERE (? IS NULL OR e.id = ?)
             AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id = e.id AND a.date = ?)
             AND NOT EXISTS (SELECT 1 FROM permission_requests p
                             WHERE p.employee_id = e.id AND p.date = ? AND p.status = 'approved')
             AND NOT EXISTS (SELECT 1 FROM permission_days d
                        WHERE d.employee_id = e.id AND d.date = ?)
             AND NOT EXISTS (SELECT 1 FROM fieldwork_days f
                             WHERE f.employee_id = e.id AND f.date = ?)
           ORDER BY e.name COLLATE NOCASE`,
        )
          .all(employeeId, employeeId, today, today, today, today);
      return rows.map((r) => ({
        id: null,
        employeeId: r.id,
        employeeName: r.name,
        date: today,
        checkIn: null,
        checkOut: null,
        hours: null,
        earlyLeave: false,
        status: 'absent',
      }));
    }

    const effectiveStatus = `CASE
      WHEN fw.employee_id IS NOT NULL THEN 'fieldwork'
      WHEN EXISTS (SELECT 1 FROM permission_requests p
                   WHERE p.employee_id = a.employee_id AND p.date = a.date AND p.status = 'approved')
           OR EXISTS (SELECT 1 FROM permission_days d
                      WHERE d.employee_id = a.employee_id AND d.date = a.date)
        THEN 'permission'
      ELSE a.status
    END`;
    return db
      .prepare(
        `SELECT a.*, e.name, ${effectiveStatus} AS effective_status
         FROM attendance a JOIN employees e ON e.id = a.employee_id
         LEFT JOIN fieldwork_days fw ON fw.employee_id = a.employee_id AND fw.date = a.date
         WHERE (? IS NULL OR a.employee_id = ?)
           AND (? IS NULL OR a.date >= ?)
           AND (? IS NULL OR a.date <= ?)
           AND (? IS NULL OR ${effectiveStatus} = ?)
         ORDER BY a.date DESC, a.check_in DESC
         LIMIT ${limit}`,
      )
      .all(employeeId, employeeId, from, from, to, to, status, status)
      .map((r) => ({ ...toRecord(r), status: r.effective_status }));
  }

  router.get('/', (req, res) => res.json(findRecords(req)));

  router.get('/report', (req, res) => {
    const records = findRecords(req);
    const closed = records.filter((r) => r.hours !== null);
    const average = closed.length ? closed.reduce((sum, r) => sum + r.hours, 0) / closed.length : 0;
    res.json({
      summary: {
        total: records.length,
        present: records.filter((r) => r.status === 'present').length,
        late: records.filter((r) => r.status === 'late').length,
        absent: records.filter((r) => r.status === 'absent').length,
        permission: records.filter((r) => r.status === 'permission').length,
        fieldwork: records.filter((r) => r.status === 'fieldwork').length,
        averageHours: Math.round(average * 100) / 100,
      },
      records,
    });
  });

  router.get('/stats', (req, res) => {
    const employeeId = req.user.role === 'admin' ? null : (req.user.employeeId ?? -1);
    const today = localDate();
    const { total } = db
      .prepare('SELECT COUNT(*) AS total FROM employees WHERE (? IS NULL OR id = ?)')
      .get(employeeId, employeeId);
    const todayRecords = db
      .prepare(
        `SELECT a.*, e.name FROM attendance a JOIN employees e ON e.id = a.employee_id
         WHERE a.date = ? AND (? IS NULL OR a.employee_id = ?)`,
      )
      .all(today, employeeId, employeeId)
      .map(toRecord);
    const manualPermissionEmployeeIds = db
      .prepare('SELECT employee_id FROM permission_days WHERE date = ? AND (? IS NULL OR employee_id = ?)')
      .all(today, employeeId, employeeId)
      .map((r) => r.employee_id);
    const permissionEmployeeIds = db
      .prepare(
        `SELECT employee_id FROM permission_days WHERE date = ? AND (? IS NULL OR employee_id = ?)
         UNION
         SELECT employee_id FROM permission_requests WHERE date = ? AND status = 'approved' AND (? IS NULL OR employee_id = ?)`,
      )
      .all(today, employeeId, employeeId, today, employeeId, employeeId)
      .map((r) => r.employee_id);
    const fieldworkEmployeeIds = db
      .prepare('SELECT employee_id FROM fieldwork_days WHERE date = ? AND (? IS NULL OR employee_id = ?)')
      .all(today, employeeId, employeeId)
      .map((r) => r.employee_id);
    const fieldworkIds = new Set(fieldworkEmployeeIds);
    const permissionIds = new Set(permissionEmployeeIds.filter((id) => !fieldworkIds.has(id)));
    const classifiedToday = todayRecords.map((r) => ({
      ...r,
      status: fieldworkIds.has(r.employeeId) ? 'fieldwork' : permissionIds.has(r.employeeId) ? 'permission' : r.status,
    }));
    const represented = new Set(classifiedToday.map((r) => r.employeeId));
    for (const employeeId of [...permissionIds, ...fieldworkIds]) {
      if (represented.has(employeeId)) continue;
      const employee = getEmployee.get(employeeId);
      if (!employee) continue;
      classifiedToday.push({
        id: null,
        employeeId,
        employeeName: employee.name,
        date: today,
        checkIn: null,
        checkOut: null,
        hours: null,
        earlyLeave: false,
        status: fieldworkIds.has(employeeId) ? 'fieldwork' : 'permission',
      });
    }
    const presentRecords = classifiedToday.filter((r) => r.status === 'present' || r.status === 'late');
    const late = presentRecords.filter((r) => r.status === 'late').length;
    const workday = isWorkday(new Date());
    res.json({
      date: today,
      workday,
      workStart: config.workStart,
      workEnd: config.workEnd,
      workEndSat: config.workEndSat,
      now: new Date().toISOString(),
      workDays: config.workDays,
      totalEmployees: total,
      presentToday: presentRecords.length,
      lateToday: late,
      permissionToday: permissionIds.size,
      fieldworkToday: fieldworkIds.size,
      permissionEmployeeIds: [...permissionIds],
      manualPermissionEmployeeIds,
      fieldworkEmployeeIds,
      absentToday: workday ? Math.max(0, total - presentRecords.length - permissionIds.size - fieldworkIds.size) : 0,
      today: classifiedToday,
    });
  });

  // Same filters as GET /, as a spreadsheet-friendly download.
  router.get('/export.csv', (req, res) => {
    const header = ['Employee', 'Date', 'Check in', 'Check out', 'Hours', 'Status'];
    const lines = findRecords(req, EXPORT_LIMIT).map((r) =>
      [r.employeeName, r.date, localDateTime(r.checkIn), localDateTime(r.checkOut), r.hours, r.status]
        .map(csvCell)
        .join(','),
    );
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="attendance-${localDate()}.csv"`,
    });
    // BOM so Excel reads UTF-8 names correctly.
    res.send(`﻿${[header.join(','), ...lines].join('\r\n')}\r\n`);
  });

  // Weekly / monthly report as an Excel, Word or PDF download.
  router.get('/report/download', async (req, res) => {
    const format = FORMATS[req.query.format];
    if (!format) throw new HttpError(400, 'format must be xlsx, docx or pdf');
    const now = new Date();
    let from;
    let to = localDate(now);
    let title;
    switch (req.query.period) {
      case 'week':
        from = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
        title = 'Weekly report (last 7 days)';
        break;
      case 'month':
        from = localDate(new Date(now.getFullYear(), now.getMonth(), 1));
        title = 'Monthly report (this month)';
        break;
      case 'lastMonth':
        from = localDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
        to = localDate(new Date(now.getFullYear(), now.getMonth(), 0));
        title = 'Monthly report (last month)';
        break;
      default:
        throw new HttpError(400, 'period must be week, month or lastMonth');
    }

    const scope = req.user.role === 'admin' ? null : (req.user.employeeId ?? -1);
    const employees = db
      .prepare('SELECT id, name FROM employees WHERE (? IS NULL OR id = ?) ORDER BY name COLLATE NOCASE')
      .all(scope, scope);
    const records = db
      .prepare(
        `SELECT a.*, e.name FROM attendance a JOIN employees e ON e.id = a.employee_id
         WHERE (? IS NULL OR a.employee_id = ?) AND a.date >= ? AND a.date <= ?
         ORDER BY a.date ASC, e.name COLLATE NOCASE ASC, a.check_in ASC
         LIMIT ${EXPORT_LIMIT}`,
      )
      .all(scope, scope, from, to)
      .map(toRecord);

    const report = buildReport({ title, from, to, employees, records, generatedAt: now.toISOString() });
    const file = await format.build(report);
    res.set({
      'Content-Type': format.type,
      'Content-Disposition': `attachment; filename="attendance-${req.query.period}-${to}.${req.query.format}"`,
    });
    res.send(file);
  });

  // One row per employee for a calendar month.
  router.get('/monthly', (req, res) => {
    const month = req.query.month === undefined ? localDate().slice(0, 7) : req.query.month;
    if (typeof month !== 'string' || !MONTH_RE.test(month)) throw new HttpError(400, 'month must be YYYY-MM');
    const scope = req.user.role === 'admin' ? null : (req.user.employeeId ?? -1);

    const people = db
      .prepare(
        'SELECT id, name, created_at FROM employees WHERE (? IS NULL OR id = ?) ORDER BY name COLLATE NOCASE',
      )
      .all(scope, scope);
    const records = db
      .prepare(
        `SELECT * FROM attendance WHERE date >= ? AND date <= ? AND (? IS NULL OR employee_id = ?)`,
      )
      .all(`${month}-01`, `${month}-31`, scope, scope);

    const byEmployee = new Map(
      people.map((p) => [
        p.id,
        {
          employeeId: p.id,
          employeeName: p.name,
          daysWorked: 0,
          onTime: 0,
          late: 0,
          absentDays: 0,
          totalHours: 0,
          closedDays: 0,
        },
      ]),
    );
    // Absent days: work days in the month, from the employee's start, with no check-in.
    // Only days that are over count: through yesterday, or today once the work day has ended.
    const [year, monthIndex] = [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1];
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (nowMinutes >= endMinutesFor(now.getDay()) ? 0 : 1));
    const monthEnd = new Date(year, monthIndex + 1, 0);
    const lastCounted = monthEnd < cutoff ? monthEnd : cutoff;
    const datesByEmployee = new Map();
    for (const r of records) {
      if (!datesByEmployee.has(r.employee_id)) datesByEmployee.set(r.employee_id, new Set());
      datesByEmployee.get(r.employee_id).add(r.date);
    }
    for (const p of people) {
      // created_at is stored in UTC; use the local calendar day the employee was added.
      const added = new Date(`${p.created_at.replace(' ', 'T')}Z`);
      let day = new Date(year, monthIndex, 1);
      const addedDay = new Date(added.getFullYear(), added.getMonth(), added.getDate());
      if (addedDay > day) day = addedDay;
      const worked = datesByEmployee.get(p.id) ?? new Set();
      const excused = new Set(
        db
          .prepare(
            `SELECT date FROM permission_requests WHERE employee_id = ? AND status = 'approved' AND date >= ? AND date <= ?
             UNION SELECT date FROM permission_days WHERE employee_id = ? AND date >= ? AND date <= ?
             UNION SELECT date FROM fieldwork_days WHERE employee_id = ? AND date >= ? AND date <= ?`,
          )
           .all(p.id, `${month}-01`, `${month}-31`, p.id, `${month}-01`, `${month}-31`, p.id, `${month}-01`, `${month}-31`)
          .map((row) => row.date),
      );
      let absent = 0;
      for (; day <= lastCounted; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
        const date = localDate(day);
        if (isWorkday(day) && !worked.has(date) && !excused.has(date)) absent += 1;
      }
      byEmployee.get(p.id).absentDays = absent;
    }

    for (const r of records) {
      const row = byEmployee.get(r.employee_id);
      row.daysWorked += 1;
      if (r.status === 'late') row.late += 1;
      else row.onTime += 1;
      const hours = toRecord({ ...r, name: '' }).hours;
      if (hours !== null) {
        row.totalHours += hours;
        row.closedDays += 1;
      }
    }

    const round = (n) => Math.round(n * 100) / 100;
    const rows = [...byEmployee.values()].map(({ closedDays, totalHours, ...row }) => ({
      ...row,
      totalHours: round(totalHours),
      averageHours: closedDays ? round(totalHours / closedDays) : 0,
    }));
    res.json({ month, rows });
  });

  // Corrections: fix a wrong / forgotten check-in or check-out time. Admins edit any record, employees their own.
  router.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid record id');
    const record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(id);
    if (!record) throw new HttpError(404, 'Record not found');
    if (req.user.role !== 'admin' && record.employee_id !== req.user.employeeId) {
      throw new HttpError(403, 'You can only edit your own attendance');
    }

    const checkIn = parseInstant(req.body?.checkIn, 'Check-in', { required: true });
    const checkOut = parseInstant(req.body?.checkOut, 'Check-out', { required: false });
    if (checkOut && Date.parse(checkOut) <= Date.parse(checkIn)) {
      throw new HttpError(400, 'Check-out must be after check-in');
    }

    // The day and on-time/late status follow the (possibly corrected) check-in time.
    const inDate = new Date(checkIn);
    try {
      db.prepare('UPDATE attendance SET date = ?, check_in = ?, check_out = ?, status = ? WHERE id = ?').run(
        localDate(inDate),
        checkIn,
        checkOut,
        statusAt(inDate),
        id,
      );
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        throw new HttpError(409, 'That employee already has a record on that date');
      }
      throw err;
    }
    const updated = db
      .prepare('SELECT a.*, e.name FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE a.id = ?')
      .get(id);
    res.json(toRecord(updated));
  });

  router.delete('/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid record id');
    const { changes } = db.prepare('DELETE FROM attendance WHERE id = ?').run(id);
    if (!changes) throw new HttpError(404, 'Record not found');
    res.status(204).end();
  });

  // Per-day on-time / late head-counts for the last N days (oldest first), for the dashboard chart.
  router.get('/trend', (req, res) => {
    const days = req.query.days === undefined ? 7 : Number(req.query.days);
    if (!Number.isInteger(days) || days < 1 || days > 31) throw new HttpError(400, 'days must be 1-31');

    const employeeId = req.user.role === 'admin' ? null : (req.user.employeeId ?? -1);
    const now = new Date();
    const dates = [];
    const workdayOf = new Map();
    for (let i = days - 1; i >= 0; i -= 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      dates.push(localDate(day));
      workdayOf.set(localDate(day), isWorkday(day));
    }

    const rows = db
      .prepare(
        `SELECT date, status, COUNT(*) AS n FROM attendance
         WHERE date >= ? AND date <= ? AND (? IS NULL OR employee_id = ?)
         GROUP BY date, status`,
      )
      .all(dates[0], dates[dates.length - 1], employeeId, employeeId);
    const counts = new Map(dates.map((date) => [date, { date, workday: workdayOf.get(date), onTime: 0, late: 0 }]));
    for (const { date, status, n } of rows) {
      counts.get(date)[status === 'late' ? 'late' : 'onTime'] = n;
    }

    const { total } = db
      .prepare('SELECT COUNT(*) AS total FROM employees WHERE (? IS NULL OR id = ?)')
      .get(employeeId, employeeId);
    res.json({ totalEmployees: total, days: [...counts.values()] });
  });

  router.post('/check-in', (req, res) => {
    const employee = targetEmployee(req);
    const now = new Date();
    const date = localDate(now);
    if (getRecord.get(employee.id, date)) throw new HttpError(409, `${employee.name} already checked in today`);

    try {
      db.prepare(
        'INSERT INTO attendance (employee_id, date, check_in, status) VALUES (?, ?, ?, ?)',
      ).run(employee.id, date, now.toISOString(), statusAt(now));
    } catch (err) {
      // Two simultaneous requests can both pass the check above; the UNIQUE index decides.
      if (String(err.message).includes('UNIQUE')) {
        throw new HttpError(409, `${employee.name} already checked in today`);
      }
      throw err;
    }
    res.status(201).json(toRecord(getRecord.get(employee.id, date)));
  });

  router.post('/fieldwork', requireAdmin, (req, res) => {
    const employee = targetEmployee(req);
    if (typeof req.body?.fieldwork !== 'boolean') throw new HttpError(400, 'fieldwork must be true or false');
    const date = localDate();
    if (req.body.fieldwork) {
      db.prepare('DELETE FROM permission_days WHERE employee_id = ? AND date = ?').run(employee.id, date);
      db.prepare('INSERT OR IGNORE INTO fieldwork_days (employee_id, date) VALUES (?, ?)').run(employee.id, date);
    } else {
      db.prepare('DELETE FROM fieldwork_days WHERE employee_id = ? AND date = ?').run(employee.id, date);
    }
    res.json({ employeeId: employee.id, date, fieldwork: req.body.fieldwork });
  });

  router.post('/permission', requireAdmin, (req, res) => {
    const employee = targetEmployee(req);
    if (typeof req.body?.permission !== 'boolean') throw new HttpError(400, 'permission must be true or false');
    const date = localDate();
    if (req.body.permission) {
      db.prepare('DELETE FROM fieldwork_days WHERE employee_id = ? AND date = ?').run(employee.id, date);
      db.prepare('INSERT OR IGNORE INTO permission_days (employee_id, date) VALUES (?, ?)').run(employee.id, date);
    } else {
      db.prepare('DELETE FROM permission_days WHERE employee_id = ? AND date = ?').run(employee.id, date);
    }
    res.json({ employeeId: employee.id, date, permission: req.body.permission });
  });

  router.post('/check-out', (req, res) => {
    const employee = targetEmployee(req);
    const now = new Date();
    const date = localDate(now);
    const record = getRecord.get(employee.id, date);
    if (!record) throw new HttpError(409, `${employee.name} has not checked in today`);
    if (record.check_out) throw new HttpError(409, `${employee.name} already checked out today`);

    db.prepare('UPDATE attendance SET check_out = ? WHERE id = ?').run(now.toISOString(), record.id);
    res.json(toRecord(getRecord.get(employee.id, date)));
  });

  // Wipes every attendance record (employees are kept).
  router.delete('/', requireAdmin, (_req, res) => {
    const { changes } = db.prepare('DELETE FROM attendance').run();
    db.prepare('DELETE FROM permission_days').run();
    db.prepare('DELETE FROM fieldwork_days').run();
    res.json({ deleted: changes });
  });

  return router;
}

module.exports = { createAttendanceRouter };
