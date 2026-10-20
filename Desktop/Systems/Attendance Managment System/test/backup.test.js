const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../server/db');
const { backupDatabase } = require('../server/backup');

test('backup is a restorable snapshot and old ones are pruned', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'att-backup-'));
  try {
    const db = openDb(path.join(dir, 'live.db'));
    db.prepare('INSERT INTO employees (name, email, role, id_card) VALUES (?, ?, ?, ?)').run('Ann', 'a@x.io', 'dev', '1');

    const files = [];
    for (let i = 0; i < 4; i += 1) {
      files.push(backupDatabase(db, path.join(dir, 'backups'), 2));
      await new Promise((resolve) => setTimeout(resolve, 5)); // distinct timestamps
    }

    const remaining = fs.readdirSync(path.join(dir, 'backups')).sort();
    assert.equal(remaining.length, 2);
    assert.deepEqual(remaining, files.slice(-2).map((f) => path.basename(f)));

    const copy = new DatabaseSync(files.at(-1));
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM employees').get().n, 1);
    copy.close();
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
