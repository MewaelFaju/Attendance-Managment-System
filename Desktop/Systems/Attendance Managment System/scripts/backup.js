// Manual backup: npm run backup
const config = require('../server/config');
const { openDb } = require('../server/db');
const { backupDatabase } = require('../server/backup');

if (config.dbPath === ':memory:') {
  console.error('Nothing to back up: DB_PATH is :memory:');
  process.exit(1);
}
const db = openDb(config.dbPath);
console.log(`Backup written: ${backupDatabase(db, config.backupDir, config.backupKeep)}`);
db.close();
