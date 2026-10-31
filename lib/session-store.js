'use strict';
/**
 * SQLite-backed session store.
 *
 * express-session's MemoryStore is per-process: behind more than one instance
 * (or a serverless platform that freezes and reuses workers) a login would
 * silently drop between requests. Sessions live in the same SQLite database as
 * the rest of the app, so cookies keep working across restarts and instances
 * that share a volume.
 */
const session = require('express-session');
const { get, run, all } = require('./db');

const DEFAULT_TTL = 1000 * 60 * 60 * 24 * 14; // matches the cookie in app.js

class SQLiteStore extends session.Store {
  constructor(options = {}) {
    super();
    this.ttl = options.ttl || DEFAULT_TTL;
  }

  expiryFor(sess) {
    const expires = sess && sess.cookie && sess.cookie.expires;
    const ms = expires ? new Date(expires).getTime() : NaN;
    return Number.isFinite(ms) ? ms : Date.now() + this.ttl;
  }

  get(sid, cb) {
    try {
      const row = get('SELECT data, expires_at FROM sessions WHERE sid = ?', sid);
      if (!row) return cb(null, null);
      if (row.expires_at <= Date.now()) {
        run('DELETE FROM sessions WHERE sid = ?', sid);
        return cb(null, null);
      }
      return cb(null, JSON.parse(row.data));
    } catch (err) {
      return cb(err);
    }
  }

  set(sid, sess, cb = () => {}) {
    try {
      run(
        `INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`,
        sid,
        JSON.stringify(sess),
        this.expiryFor(sess)
      );
      // Cheap housekeeping: prune expired rows occasionally instead of on a timer.
      if (Math.random() < 0.02) run('DELETE FROM sessions WHERE expires_at <= ?', Date.now());
      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }

  touch(sid, sess, cb = () => {}) {
    try {
      run('UPDATE sessions SET expires_at = ? WHERE sid = ?', this.expiryFor(sess), sid);
      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }

  destroy(sid, cb = () => {}) {
    try {
      run('DELETE FROM sessions WHERE sid = ?', sid);
      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }

  length(cb) {
    try {
      const row = get('SELECT COUNT(*) AS c FROM sessions WHERE expires_at > ?', Date.now());
      return cb(null, row.c);
    } catch (err) {
      return cb(err);
    }
  }

  clear(cb = () => {}) {
    try {
      run('DELETE FROM sessions');
      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }

  all(cb) {
    try {
      const rows = all('SELECT data FROM sessions WHERE expires_at > ?', Date.now());
      return cb(null, rows.map((r) => JSON.parse(r.data)));
    } catch (err) {
      return cb(err);
    }
  }
}

module.exports = { SQLiteStore };
