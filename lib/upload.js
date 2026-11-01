'use strict';
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { UPLOAD_DIR } = require('./paths');

/** Writable upload folder — public/uploads locally, /tmp/... on serverless. */
const ROOT = UPLOAD_DIR;

const FIELDS = {
  cover: { dir: 'covers', mimes: /^image\/(jpeg|png|webp|gif)$/, maxMb: 8 },
  audio: { dir: 'audio', mimes: /^audio\/(mpeg|mp3|wav|x-wav|wave|ogg|mp4|m4a|x-m4a|aac|flac)$/, maxMb: 40 },
  video: { dir: 'video', mimes: /^video\/(mp4|webm|quicktime|x-matroska|ogg)$/, maxMb: 120 },
};

function storageFor(dir) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(ROOT, dir)),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').toLowerCase().slice(0, 8);
      cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext}`);
    },
  });
}

/**
 * One multer instance handles beat cover art, beat audio and promo video.
 * Files are filtered per field name, so a mislabelled upload is rejected
 * instead of ending up in the wrong folder.
 */
const uploader = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const cfg = FIELDS[file.fieldname];
      cb(null, path.join(ROOT, cfg ? cfg.dir : 'covers'));
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').toLowerCase().slice(0, 8);
      cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 120 * 1024 * 1024, files: 3 },
  fileFilter: (req, file, cb) => {
    const cfg = FIELDS[file.fieldname];
    if (!cfg) return cb(new Error(`Unexpected upload field: ${file.fieldname}`));
    if (!cfg.mimes.test(file.mimetype)) {
      return cb(new Error(`"${file.fieldname}" must be ${cfg.mimes.source.split('|').join(', ')}`));
    }
    cb(null, true);
  },
});

/** Accept either a real folder path under /uploads or a safe https URL. */
function safeImageValue(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('/uploads/')) return v;
  return null;
}

module.exports = { uploader, storageFor, FIELDS, ROOT, safeImageValue };
