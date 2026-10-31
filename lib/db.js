'use strict';
/**
 * SQLite storage layer.
 * Uses Node's built-in `node:sqlite` driver (Node >= 22.5) so the project has
 * no native build step. Data lives in data/producer.db.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'producer.db');

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'artist',           -- 'artist' | 'admin'
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS beats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    genre TEXT,
    bpm INTEGER,
    musical_key TEXT,
    price_cents INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    cover_image TEXT,
    audio_file TEXT,
    is_published INTEGER NOT NULL DEFAULT 1,
    plays INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    kind TEXT NOT NULL DEFAULT 'upload',           -- 'upload' | 'embed'
    video_file TEXT,
    embed_url TEXT,
    thumb_image TEXT,
    is_published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    beat_id INTEGER NOT NULL REFERENCES beats(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL,
    license TEXT NOT NULL DEFAULT 'lease',
    method TEXT NOT NULL DEFAULT 'momo',           -- 'momo' | 'bank'
    provider TEXT,                                  -- 'mtn' | 'vodafone' | 'airteltigo'
    account_number TEXT,
    status TEXT NOT NULL DEFAULT 'pending',        -- 'pending' | 'paid' | 'failed'
    download_token TEXT NOT NULL,
    download_count INTEGER NOT NULL DEFAULT 0,
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender TEXT NOT NULL,                           -- 'artist' | 'producer'
    body TEXT NOT NULL,
    read_by_admin INTEGER NOT NULL DEFAULT 0,
    read_by_artist INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Every outgoing email is persisted here so the app works without SMTP.
  CREATE TABLE IF NOT EXISTS mail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email TEXT NOT NULL,
    to_name TEXT,
    subject TEXT NOT NULL,
    html TEXT NOT NULL,
    text TEXT,
    category TEXT,                                  -- order | payment | sale | message | welcome | download
    sent INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
`);

/* ---------------------------------------------------------------- helpers */
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${sha(salt + password)}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = sha(salt + password);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

function token(n = 24) {
  return crypto.randomBytes(n).toString('hex');
}

const all = (sql, ...params) => db.prepare(sql).all(...params);
const get = (sql, ...params) => db.prepare(sql).get(...params);
const run = (sql, ...params) => db.prepare(sql).run(...params);

/* --------------------------------------------------------- seed defaults */
function seed() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@bassline.studio').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'producer123';
  const existing = get('SELECT id FROM users WHERE role = ?', 'admin');
  if (!existing) {
    run(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      process.env.PRODUCER_NAME || 'Kobby Waves',
      adminEmail,
      hashPassword(adminPassword),
      'admin'
    );
    console.log(`  ↳ Admin account created: ${adminEmail} / ${adminPassword}`);
  }

  if (get('SELECT COUNT(*) AS c FROM beats').c === 0) {
    const rows = [
      {
        title: 'Midnight Accra', genre: 'Afrobeats', bpm: 102, key: 'F# minor', price: 4500,
        desc: 'Warm log drums, scattered shakers and a hook that refuses to leave your head. Built for a smooth, melodic afrobeats vocal.',
        cover: '/uploads/covers/seed-midnight-accra.jpg', audio: '/uploads/audio/seed-midnight-accra.wav',
      },
      {
        title: 'Neon Highway', genre: 'Trap', bpm: 140, key: 'C minor', price: 5000,
        desc: 'Wide 808 slides with neon-soaked synth arps for late-night drives. Space for a fast, rhythmic flow.',
        cover: '/uploads/covers/seed-neon-highway.jpg', audio: '/uploads/audio/seed-neon-highway.wav',
      },
      {
        title: 'Violet Skies', genre: 'R&B', bpm: 88, key: 'A major', price: 4000,
        desc: 'Silky Rhodes chords, brushed drums and room for a vocal to breathe. Slow-burn, late-night R&B.',
        cover: '/uploads/covers/seed-violet-skies.jpg', audio: '/uploads/audio/seed-violet-skies.wav',
      },
      {
        title: 'Cyan Machine', genre: 'Drill', bpm: 144, key: 'G minor', price: 5500,
        desc: 'Cold sliding bass and crisp Chicago-style hats with a cinematic intro. Built for a hard, confident verse.',
        cover: '/uploads/covers/seed-cyan-machine.jpg', audio: '/uploads/audio/seed-cyan-machine.wav',
      },
    ];
    for (const b of rows) {
      run(
        `INSERT INTO beats (title, genre, bpm, musical_key, price_cents, description, cover_image, audio_file, is_published)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        b.title, b.genre, b.bpm, b.key, b.price, b.desc, b.cover, b.audio
      );
    }
    console.log('  ↳ Seeded 4 demo beats (art + audio included). Replace them in the producer area.');
  }

}

module.exports = { db, all, get, run, hashPassword, verifyPassword, token, seed, DB_FILE };
