const express = require('express');
const { HttpError } = require('../errors');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REASON = 500;
const MAX_NOTE = 300;

function serialize(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.name,
    date: row.date,
    reason: row.reason,
    status: row.status,
    managerNote: row.manager_note,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

// Employees ask their manager (admin) for permission (time off, late arrival, ...);
// the manager accepts or declines, and the employee sees the answer.
function createRequestsRouter({ db, authenticate, requireAdmin }) {
  const router = express.Router();
  router.use(authenticate);

  const SELECT = `SELECT r.*, e.name FROM permission_requests r JOIN employees e ON e.id = r.employee_id`;

  // Admins see everyone's requests; employees only their own.
  router.get('/', (req, res) => {
    const scope = req.user.role === 'admin' ? null : (req.user.employeeId ?? -1);
    const rows = db
      .prepare(`${SELECT} WHERE (? IS NULL OR r.employee_id = ?) ORDER BY r.id DESC LIMIT 200`)
      .all(scope, scope);
    res.json(rows.map(serialize));
  });

  router.post('/', (req, res) => {
    if (req.user.role === 'admin') throw new HttpError(403, 'Only employees can request permission');
    const employeeId = req.user.employeeId;
    if (!employeeId) throw new HttpError(403, 'Your account is not linked to an employee');

    const { date, reason } = req.body ?? {};
    if (typeof date !== 'string' || !DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
      throw new HttpError(400, 'date must be YYYY-MM-DD');
    }
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (!text) throw new HttpError(400, 'Reason is required');
    if (text.length > MAX_REASON) throw new HttpError(400, `Reason must be at most ${MAX_REASON} characters`);

    const { lastInsertRowid } = db
      .prepare('INSERT INTO permission_requests (employee_id, date, reason) VALUES (?, ?, ?)')
      .run(employeeId, date, text);
    res.status(201).json(serialize(db.prepare(`${SELECT} WHERE r.id = ?`).get(lastInsertRowid)));
  });

  // Manager accepts or declines a pending request.
  router.put('/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid request id');
    const { status, note } = req.body ?? {};
    if (status !== 'approved' && status !== 'declined') {
      throw new HttpError(400, 'status must be approved or declined');
    }
    const text = typeof note === 'string' ? note.trim() : '';
    if (text.length > MAX_NOTE) throw new HttpError(400, `Note must be at most ${MAX_NOTE} characters`);

    const existing = db.prepare('SELECT status FROM permission_requests WHERE id = ?').get(id);
    if (!existing) throw new HttpError(404, 'Request not found');
    if (existing.status !== 'pending') throw new HttpError(409, 'This request was already answered');

    db.prepare(
      "UPDATE permission_requests SET status = ?, manager_note = ?, decided_at = datetime('now') WHERE id = ?",
    ).run(status, text || null, id);
    res.json(serialize(db.prepare(`${SELECT} WHERE r.id = ?`).get(id)));
  });

  // An employee may withdraw their own request while it is still pending.
  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid request id');
    const row = db.prepare('SELECT * FROM permission_requests WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Request not found');
    if (req.user.role !== 'admin') {
      if (row.employee_id !== req.user.employeeId) throw new HttpError(403, 'You can only withdraw your own requests');
      if (row.status !== 'pending') throw new HttpError(409, 'Only pending requests can be withdrawn');
    }
    db.prepare('DELETE FROM permission_requests WHERE id = ?').run(id);
    res.status(204).end();
  });

  return router;
}

module.exports = { createRequestsRouter };
