const path = require('path');

const root = path.resolve(__dirname, '..');

try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // .env is optional
}

function parseWorkDays(value) {
  const days = value.split(',').map((d) => d.trim()).filter(Boolean).map(Number);
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new Error(`WORK_DAYS must be a comma-separated list of 0-6 (0=Sunday), got "${value}"`);
  }
  return [...new Set(days)];
}

const config = {
  root,
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || path.join(root, 'data', 'attendance.db'),
  // Work schedule, in the server's local time. Days are 0=Sunday ... 6=Saturday (default Monday-Saturday).
  // 08:45 / 17:30 = 2:45 / 11:30 on the Ethiopian clock; Saturday ends an hour earlier (10:30 Ethiopian).
  workStart: process.env.WORK_START || '08:45',
  workEnd: process.env.WORK_END || '17:30',
  workEndSat: process.env.WORK_END_SAT || '16:30',
  workDays: parseWorkDays(process.env.WORK_DAYS || '1,2,3,4,5,6'),
  jwtSecret: process.env.JWT_SECRET || null,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || null,
  // Automatic database snapshots. Set BACKUP_INTERVAL_HOURS=0 to turn them off.
  backupDir: process.env.BACKUP_DIR || path.join(root, 'backups'),
  backupKeep: Number(process.env.BACKUP_KEEP) || 14,
  backupIntervalHours: process.env.BACKUP_INTERVAL_HOURS === undefined ? 24 : Number(process.env.BACKUP_INTERVAL_HOURS),
  // Number of reverse proxies in front of the app (e.g. 1 behind Caddy/nginx) so client IPs are correct.
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : false,
  // Extra origins allowed to call the API from another server (default: VS Code Live Server).
  corsOrigins: (process.env.CORS_ORIGINS || 'http://127.0.0.1:5500,http://localhost:5500')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};

const ENV_NAMES = { workStart: 'WORK_START', workEnd: 'WORK_END', workEndSat: 'WORK_END_SAT' };
for (const key of Object.keys(ENV_NAMES)) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config[key])) {
    throw new Error(`${ENV_NAMES[key]} must be HH:MM (24h), got "${config[key]}"`);
  }
}
if (config.workEnd <= config.workStart) throw new Error('WORK_END must be later than WORK_START');
if (config.workEndSat <= config.workStart) throw new Error('WORK_END_SAT must be later than WORK_START');

module.exports = config;
