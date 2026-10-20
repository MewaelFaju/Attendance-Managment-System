const fs = require('fs');
const path = require('path');

const BACKUP_RE = /^attendance-.*\.db$/;

// Consistent snapshot of a live database (safe while the server is running), then prune old ones.
function backupDatabase(db, dir, keep = 14) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.T]/g, '-').slice(0, 23);
  const file = path.join(dir, `attendance-${stamp}.db`);
  db.prepare('VACUUM INTO ?').run(file);

  const old = fs
    .readdirSync(dir)
    .filter((name) => BACKUP_RE.test(name))
    .sort()
    .reverse()
    .slice(keep);
  for (const name of old) fs.rmSync(path.join(dir, name), { force: true });
  return file;
}

function newestBackupAge(dir) {
  try {
    const times = fs
      .readdirSync(dir)
      .filter((name) => BACKUP_RE.test(name))
      .map((name) => fs.statSync(path.join(dir, name)).mtimeMs);
    return times.length ? Date.now() - Math.max(...times) : Infinity;
  } catch {
    return Infinity;
  }
}

// Backs up now if the newest backup is older than the interval, then re-checks hourly.
function scheduleBackups(db, config) {
  if (config.dbPath === ':memory:' || !(config.backupIntervalHours > 0)) return;
  const intervalMs = config.backupIntervalHours * 3_600_000;
  const run = () => {
    if (newestBackupAge(config.backupDir) < intervalMs) return;
    try {
      const file = backupDatabase(db, config.backupDir, config.backupKeep);
      console.log(`Database backup written: ${file}`);
    } catch (err) {
      console.error('Database backup failed:', err.message);
    }
  };
  run();
  setInterval(run, 3_600_000).unref();
}

module.exports = { backupDatabase, scheduleBackups };
