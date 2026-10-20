const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const defaultConfig = require('./config');
const { openDb } = require('./db');
const { createAuth } = require('./auth');
const { createEmployeesRouter } = require('./routes/employees');
const { createAttendanceRouter } = require('./routes/attendance');
const { createRequestsRouter } = require('./routes/requests');
const { HttpError } = require('./errors');
const { renderConnectPage } = require('./connect');

// JWT secret: env var, else one persisted next to the database so sessions survive restarts.
function loadSecret(config) {
  if (config.jwtSecret) return config.jwtSecret;
  if (config.dbPath === ':memory:') return crypto.randomBytes(32).toString('hex');
  const file = path.join(path.dirname(config.dbPath), 'jwt.secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self'",
  "script-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

async function createApp(overrides = {}) {
  const config = { ...defaultConfig, ...overrides };
  const db = openDb(config.dbPath);
  const auth = createAuth({ db, config, secret: loadSecret(config) });
  const generatedAdminPassword = await auth.ensureAdmin();

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });
  // Auth uses bearer tokens (no cookies), so allowing a listed origin exposes nothing extra.
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        Vary: 'Origin',
      });
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(config.root, 'public')));

  // Unauthenticated liveness probe (used by Docker); confirms the database answers.
  app.get('/api/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });

  app.get('/connect', async (req, res) => {
    res.type('html').send(await renderConnectPage(req.socket.localPort));
  });

  app.use('/api/auth', auth.router);
  app.use('/api/employees', createEmployeesRouter({ db, ...auth }));
  app.use('/api/attendance', createAttendanceRouter({ db, config, ...auth }));
  app.use('/api/requests', createRequestsRouter({ db, ...auth }));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    // body-parser errors carry their own 4xx status.
    const status = err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    const message =
      err instanceof HttpError
        ? err.message
        : status === 413
          ? 'Request body too large'
          : status === 400
            ? 'Malformed request'
            : 'Internal server error';
    res.status(status).json({ error: message });
  });

  return { app, db, config, generatedAdminPassword };
}

module.exports = { createApp };
