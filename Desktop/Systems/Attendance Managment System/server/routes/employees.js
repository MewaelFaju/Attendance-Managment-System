const express = require('express');
const bcrypt = require('bcryptjs');
const { HttpError } = require('../errors');
const { transaction } = require('../db');
const { validateNewPassword } = require('../auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHOTO_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const MAX_PHOTO_LENGTH = 700_000;

const toEmployee = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
  idCard: row.id_card,
  photo: row.photo,
  canFilterReports: !!row.can_filter_reports,
});

function requiredString(value, label, max) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${label} is required`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `${label} must be at most ${max} characters`);
  return trimmed;
}

// `photo` is undefined when the client didn't send it (leave unchanged), null to clear it.
function parseEmployee(body = {}) {
  const email = requiredString(body.email, 'Email', 150).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email is not valid');

  let photo;
  if ('photo' in body) {
    if (body.photo === null || body.photo === '') {
      photo = null;
    } else if (
      typeof body.photo === 'string' &&
      body.photo.length <= MAX_PHOTO_LENGTH &&
      PHOTO_RE.test(body.photo)
    ) {
      photo = body.photo;
    } else {
      throw new HttpError(400, 'Photo must be a PNG, JPEG, WebP or GIF image under 500 KB');
    }
  }

  return {
    name: requiredString(body.name, 'Name', 100),
    email,
    role: requiredString(body.role, 'Role', 60),
    idCard: requiredString(body.idCard, 'ID card', 40),
    photo,
    canFilter: 'canFilterReports' in body ? (body.canFilterReports ? 1 : 0) : undefined,
  };
}

function parsePassword(value) {
  if (value === undefined || value === null || value === '') return null;
  return validateNewPassword(value);
}

function translateUniqueError(err) {
  const msg = String(err?.message || '');
  if (!msg.includes('UNIQUE constraint failed')) return err;
  if (msg.includes('employees.email') || msg.includes('users.username')) {
    return new HttpError(409, 'An employee with this email already exists');
  }
  if (msg.includes('employees.id_card')) return new HttpError(409, 'This ID card is already assigned');
  return new HttpError(409, 'Duplicate value');
}

function createEmployeesRouter({ db, authenticate, requireAdmin }) {
  const router = express.Router();
  router.use(authenticate);

  const withPermission = `SELECT e.*, COALESCE(u.can_filter_reports, 0) AS can_filter_reports
    FROM employees e LEFT JOIN users u ON u.employee_id = e.id`;
  const listAll = db.prepare(`${withPermission} ORDER BY e.name COLLATE NOCASE`);
  const getById = db.prepare(`${withPermission} WHERE e.id = ?`);
  const userForEmployee = db.prepare('SELECT id FROM users WHERE employee_id = ?');

  function parseId(req) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid employee id');
    return id;
  }

  router.get('/', (req, res) => {
    const rows =
      req.user.role === 'admin'
        ? listAll.all()
        : [getById.get(req.user.employeeId)].filter(Boolean);
    res.json(rows.map(toEmployee));
  });

  router.post('/', requireAdmin, async (req, res) => {
    const data = parseEmployee(req.body);
    const password = parsePassword(req.body?.password);
    const hash = password ? await bcrypt.hash(password, 10) : null;

    let id;
    try {
      id = transaction(db, () => {
        const { lastInsertRowid } = db
          .prepare('INSERT INTO employees (name, email, role, id_card, photo) VALUES (?, ?, ?, ?, ?)')
          .run(data.name, data.email, data.role, data.idCard, data.photo ?? null);
        if (hash) {
          db.prepare(
            "INSERT INTO users (username, password_hash, role, employee_id, can_filter_reports) VALUES (?, ?, 'employee', ?, ?)",
          ).run(data.email, hash, lastInsertRowid, data.canFilter ?? 0);
        }
        return lastInsertRowid;
      });
    } catch (err) {
      throw translateUniqueError(err);
    }
    res.status(201).json(toEmployee(getById.get(id)));
  });

  router.put('/:id', requireAdmin, async (req, res) => {
    const id = parseId(req);
    const existing = getById.get(id);
    if (!existing) throw new HttpError(404, 'Employee not found');

    const data = parseEmployee(req.body);
    const password = parsePassword(req.body?.password);
    const hash = password ? await bcrypt.hash(password, 10) : null;

    try {
      transaction(db, () => {
        db.prepare(
          'UPDATE employees SET name = ?, email = ?, role = ?, id_card = ?, photo = ? WHERE id = ?',
        ).run(
          data.name,
          data.email,
          data.role,
          data.idCard,
          data.photo === undefined ? existing.photo : data.photo,
          id,
        );

        const user = userForEmployee.get(id);
        if (user) {
          // Keep the login username in sync with the email.
          db.prepare('UPDATE users SET username = ? WHERE id = ?').run(data.email, user.id);
          if (hash) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
          if (data.canFilter !== undefined) {
            db.prepare('UPDATE users SET can_filter_reports = ? WHERE id = ?').run(data.canFilter, user.id);
          }
        } else if (hash) {
          db.prepare(
            "INSERT INTO users (username, password_hash, role, employee_id, can_filter_reports) VALUES (?, ?, 'employee', ?, ?)",
          ).run(data.email, hash, id, data.canFilter ?? 0);
        }
      });
    } catch (err) {
      throw translateUniqueError(err);
    }
    res.json(toEmployee(getById.get(id)));
  });

  router.delete('/:id', requireAdmin, (req, res) => {
    const id = parseId(req);
    const { changes } = db.prepare('DELETE FROM employees WHERE id = ?').run(id);
    if (!changes) throw new HttpError(404, 'Employee not found');
    res.status(204).end();
  });

  return router;
}

module.exports = { createEmployeesRouter };
