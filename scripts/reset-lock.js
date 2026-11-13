'use strict';

/**
 * Reset the app lock when the passphrase is lost.
 *
 * Removes the stored passphrase hash and session secret from the local
 * SQLite database. Transactions and settings are untouched.
 *
 * Run:  npm run auth:reset        (uses DATA_DIR or ./data)
 */

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const file = path.join(dataDir, 'expenses.db');

if (!fs.existsSync(file)) {
  console.error(`No database found at ${file}`);
  process.exit(1);
}

const db = new DatabaseSync(file);
try {
  db.exec("DELETE FROM settings WHERE key IN ('auth_hash', 'auth_secret')");
} finally {
  db.close();
}

console.log('App lock reset. Restart the server if it is running, then set a new passphrase in Settings.');
