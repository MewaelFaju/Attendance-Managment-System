const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { HttpError } = require('./errors');

const MAX_FAILED_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 72; // bcrypt silently ignores anything longer

// Reject over-long passwords instead of letting bcrypt truncate them.
function validateNewPassword(value) {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (Buffer.byteLength(value) > MAX_PASSWORD_BYTES) {
    throw new HttpError(400, `Password must be at most ${MAX_PASSWORD_BYTES} bytes`);
  }
  return value;
}

function createAuth({ db, config, secret }) {
  const findByUsername = db.prepare(`
    SELECT u.*, e.name AS employee_name
    FROM users u LEFT JOIN employees e ON e.id = u.employee_id
    WHERE u.username = ?`);
  const findById = db.prepare(`
    SELECT u.*, e.name AS employee_name
    FROM users u LEFT JOIN employees e ON e.id = u.employee_id
    WHERE u.id = ?`);

  // Compared against when the username is unknown, so response time doesn't reveal valid usernames.
  const dummyHash = bcrypt.hashSync('not-a-real-password', 10);
  const failures = new Map(); // key -> { count, resetAt }

  function assertNotLocked(key) {
    const entry = failures.get(key);
    if (entry && entry.resetAt > Date.now() && entry.count >= MAX_FAILED_ATTEMPTS) {
      throw new HttpError(429, 'Too many failed attempts. Try again later.');
    }
  }
  function recordFailure(key) {
    const now = Date.now();
    const entry = failures.get(key);
    const current = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + ATTEMPT_WINDOW_MS };
    current.count += 1;
    failures.set(key, current);
  }

  // Tokens carry a fingerprint of the password hash, so changing the password
  // invalidates every session issued before it.
  const fingerprint = (hash) => crypto.createHash('sha256').update(hash).digest('hex').slice(0, 16);
  const issueToken = (row) =>
    jwt.sign({ sub: row.id, role: row.role, pv: fingerprint(row.password_hash) }, secret, {
      algorithm: 'HS256',
      expiresIn: config.jwtExpiresIn,
    });

  const toPublicUser = (row) => ({
    id: row.id,
    username: row.username,
    role: row.role,
    employeeId: row.employee_id,
    canFilterReports: row.role === 'admin' || !!row.can_filter_reports,
    name: row.employee_name || (row.role === 'admin' ? 'Administrator' : row.username),
  });

  function authenticate(req, _res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Authentication required');
    let payload;
    try {
      payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    } catch {
      throw new HttpError(401, 'Invalid or expired session');
    }
    const row = findById.get(payload.sub);
    if (!row || payload.pv !== fingerprint(row.password_hash)) {
      throw new HttpError(401, 'Invalid or expired session');
    }
    req.user = toPublicUser(row);
    next();
  }

  function requireAdmin(req, _res, next) {
    if (req.user.role !== 'admin') throw new HttpError(403, 'Administrator access required');
    next();
  }

  const router = express.Router();

  router.post('/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      throw new HttpError(400, 'Username and password are required');
    }
    const key = `login:${req.ip}`;
    assertNotLocked(key);

    const row = findByUsername.get(username.trim());
    const ok = await bcrypt.compare(password, row?.password_hash ?? dummyHash);
    if (!row || !ok) {
      recordFailure(key);
      throw new HttpError(401, 'Invalid username or password');
    }

    failures.delete(key);
    res.json({ token: issueToken(row), user: toPublicUser(row) });
  });

  router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

  // Any signed-in user can change their own password. Returns a fresh token, since the old one is now void.
  router.post('/change-password', authenticate, async (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || !currentPassword) {
      throw new HttpError(400, 'Current password is required');
    }
    validateNewPassword(newPassword);
    if (newPassword === currentPassword) {
      throw new HttpError(400, 'New password must be different from the current one');
    }

    const key = `pw:${req.user.id}`;
    assertNotLocked(key);
    const row = findById.get(req.user.id);
    // 400 rather than 401: the client treats 401 as "session expired" and signs the user out.
    if (!(await bcrypt.compare(currentPassword, row.password_hash))) {
      recordFailure(key);
      throw new HttpError(400, 'Current password is incorrect');
    }

    failures.delete(key);
    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, row.id);
    res.json({ token: issueToken({ ...row, password_hash: hash }) });
  });

  // Creates the first admin account when none exists. Returns the generated password, if any.
  async function ensureAdmin() {
    const existing = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
    if (existing) return null;
    const generated = config.adminPassword ? null : crypto.randomBytes(9).toString('base64url');
    const hash = await bcrypt.hash(config.adminPassword || generated, 10);
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(
      config.adminUsername,
      hash,
    );
    return generated;
  }

  return { router, authenticate, requireAdmin, ensureAdmin };
}

module.exports = { createAuth, validateNewPassword };
