'use strict';

/**
 * Database adapter — one async API, two runtimes:
 *
 *   NodeDB  (node:sqlite)     → `npm start` (server.js), file at DATA_DIR
 *   D1DB    (Cloudflare D1)   → worker.js on Cloudflare (binding "DB")
 *
 * Interface (all async, so both runtimes share the same calling code):
 *   all(sql, params?)   → rows[]
 *   get(sql, params?)   → row | null
 *   run(sql, params?)   → { changes, lastInsertRowid }
 *   exec(sql)           → multi-statement SQL, no parameters (DDL / seed)
 *   batch(stmts)        → atomic [{ sql, params? }] (chunked on D1 free tier)
 */

/** Split a multi-statement SQL string on ';', respecting quoted literals. */
function splitSql(sql) {
  const parts = [];
  let cur = '';
  let inStr = false;
  let quote = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inStr) {
      cur += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) { cur += sql[i + 1]; i++; } // doubled quote → literal
        else inStr = false;
      }
      continue;
    }
    if (ch === "'" || ch === '"') { inStr = true; quote = ch; cur += ch; continue; }
    if (ch === ';') { if (cur.trim()) parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/* ------------------------------------------------------------------ */
/* Node.js runtime (node:sqlite)                                      */
/* ------------------------------------------------------------------ */

class NodeDB {
  constructor(filePath) {
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  async all(sql, params = []) { return this.db.prepare(sql).all(...params); }

  async get(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }

  async run(sql, params = []) {
    const info = this.db.prepare(sql).run(...params);
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  }

  async exec(sql) { this.db.exec(sql); }

  /** Atomic multi-statement write via a real transaction. */
  async batch(stmts) {
    this.db.exec('BEGIN');
    try {
      const out = [];
      for (const s of stmts) out.push(await this.run(s.sql, s.params || []));
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Cloudflare Workers runtime (D1 binding)                             */
/* ------------------------------------------------------------------ */

class D1DB {
  constructor(d1) { this.db = d1; }

  async all(sql, params = []) {
    const r = await this.db.prepare(sql).bind(...params).all();
    return r.results || [];
  }

  async get(sql, params = []) { return await this.db.prepare(sql).bind(...params).first() ?? null; }

  async run(sql, params = []) {
    const r = await this.db.prepare(sql).bind(...params).run();
    return { changes: (r.meta && r.meta.changes) || 0, lastInsertRowid: (r.meta && r.meta.last_row_id) || 0 };
  }

  /**
   * Multi-statement SQL without parameters (schema / seed).
   * D1's exec() splits input on newlines and rejects multi-line statements,
   * so statements are sent through batch() instead — atomic and multi-line
   * safe. PRAGMAs are skipped (D1 manages its own journal mode).
   */
  async exec(sql) {
    const parts = splitSql(sql).filter(s => !/^PRAGMA/i.test(s));
    if (!parts.length) return;
    for (let i = 0; i < parts.length; i += 20) {
      await this.db.batch(parts.slice(i, i + 20).map(s => this.db.prepare(s)));
    }
  }

  /**
   * Bulk multi-statement write. D1 counts a whole batch() as ONE query
   * against the 50-queries-per-invocation free-plan limit, so chunks are
   * sized to keep even a 5,000-row CSV import (plus its other queries) inside
   * that budget. Each statement is still subject to the per-statement limits.
   */
  async batch(stmts) {
    const CHUNK = 250;
    const out = [];
    for (let i = 0; i < stmts.length; i += CHUNK) {
      const chunk = stmts.slice(i, i + CHUNK);
      const res = await this.db.batch(
        chunk.map(s => (s.params && s.params.length ? this.db.prepare(s.sql).bind(...s.params) : this.db.prepare(s.sql)))
      );
      for (const r of res) out.push(r.results || { changes: (r.meta && r.meta.changes) || 0 });
    }
    return out;
  }
}

module.exports = { NodeDB, D1DB, splitSql };
