'use strict';
/**
 * Filesystem layout, in one place.
 *
 * Locally (and on any normal Node host) the database lives in ./data and
 * uploads go into the committed public/uploads folder, exactly like before.
 *
 * On a read-only / ephemeral platform (Vercel, AWS Lambda, Netlify functions)
 * only /tmp can be written to, so both move there instead of crashing the
 * first time an order or an upload is saved. Point STUDIO_STORAGE_DIR at a
 * real volume on a persistent host and everything survives redeploys.
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
/** Demo cover art + audio previews that ship with the repo (read-only). */
const BUNDLED_UPLOADS = path.join(PUBLIC_DIR, 'uploads');

const READ_ONLY_FS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const STORAGE_DIR = path.resolve(
  process.env.STUDIO_STORAGE_DIR || (READ_ONLY_FS ? path.join('/tmp', 'bassline-studio') : path.join(ROOT, 'data'))
);

const DB_FILE = path.resolve(process.env.DB_FILE || path.join(STORAGE_DIR, 'producer.db'));

/** Where new uploads are written. Bundled demo assets stay in the repo. */
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || (READ_ONLY_FS ? path.join(STORAGE_DIR, 'uploads') : BUNDLED_UPLOADS));

for (const dir of [path.dirname(DB_FILE), UPLOAD_DIR, ...['covers', 'audio', 'video'].map((d) => path.join(UPLOAD_DIR, d))]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.warn(`  ⚠  Could not create ${dir}: ${err.message}`);
  }
}

const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);

/**
 * Turns a stored web path such as "/uploads/audio/123-ab.mp3" into a real file,
 * looking in the writable upload folder first and the bundled demo assets after.
 * Returns null when the file is missing or the path escapes the upload folders.
 */
function resolveUpload(webPath) {
  if (!webPath) return null;
  const rel = String(webPath).replace(/^\/+/, '');
  if (!rel.startsWith('uploads/')) return null;
  const inner = rel.slice('uploads/'.length);
  for (const base of [UPLOAD_DIR, BUNDLED_UPLOADS]) {
    const abs = path.join(base, inner);
    if (inside(base, abs) && fs.existsSync(abs)) return abs;
  }
  return null;
}

module.exports = {
  ROOT,
  PUBLIC_DIR,
  BUNDLED_UPLOADS,
  STORAGE_DIR,
  DB_FILE,
  UPLOAD_DIR,
  READ_ONLY_FS,
  resolveUpload,
  inside,
};
