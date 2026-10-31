'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const { all, get, run } = require('../lib/db');
const orders = require('../lib/orders');
const { uploader, safeImageValue } = require('../lib/upload');
const { sendMessageEmail, markPaid } = require('../lib/orders');
const { isSmtpConfigured, smtpConfig } = require('../lib/mailer');
const payments = require('../lib/payments');

const PUBLIC = path.join(__dirname, '..', 'public');
const rel = (f) => (f ? `/uploads/${f.destination.split(/[\\/]/).pop()}/${f.filename}` : null);

module.exports = ({ flash }) => {
  const router = express.Router();

  router.use((req, res, next) => {
    const user = res.locals.currentUser;
    if (!user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (user.role !== 'admin') {
      res.status(403).render('error', { title: 'Producers only', code: 403, message: 'This area is for the studio owner.' });
      return;
    }
    next();
  });

  /* --------------------------------------------------------------- overview */
  router.get('/', (req, res) => {
    const revenue = get("SELECT COALESCE(SUM(amount_cents),0) s FROM orders WHERE status = 'paid'").s;
    const pending = get("SELECT COUNT(*) c FROM orders WHERE status = 'pending'").c;
    const sales = all(
      `SELECT o.*, b.title, u.name AS artist, u.email FROM orders o
         JOIN beats b ON b.id = o.beat_id JOIN users u ON u.id = o.user_id
        WHERE o.status = 'paid' ORDER BY o.paid_at DESC LIMIT 6`
    );
    const unreadMessages = get("SELECT COUNT(*) c FROM messages WHERE sender = 'artist' AND read_by_admin = 0").c;
    res.render('admin/dashboard', {
      title: 'Producer area',
      revenue,
      pending,
      sales,
      unreadMessages,
      counts: {
        beats: get('SELECT COUNT(*) c FROM beats').c,
        videos: get('SELECT COUNT(*) c FROM videos').c,
        artists: get("SELECT COUNT(*) c FROM users WHERE role = 'artist'").c,
        orders: get('SELECT COUNT(*) c FROM orders').c,
        mail: get('SELECT COUNT(*) c FROM mail').c,
      },
      recentMail: all('SELECT * FROM mail ORDER BY id DESC LIMIT 5'),
    });
  });

  /* ----------------------------------------------------------------- beats */
  router.get('/beats', (req, res) => {
    res.render('admin/beats', {
      title: 'Beats',
      beats: all(
        `SELECT b.*, (SELECT COUNT(*) FROM orders o WHERE o.beat_id = b.id AND o.status = 'paid') AS sales
           FROM beats b ORDER BY b.created_at DESC, b.id DESC`
      ),
    });
  });

  router.post('/beats', uploader.fields([{ name: 'cover', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), (req, res, next) => {
    try {
      const title = String(req.body.title || '').trim();
      if (!title) {
        flash(req, 'error', 'A beat needs a title.');
        return res.redirect('/admin/beats');
      }
      const price = Math.round(parseFloat(String(req.body.price || '0').replace(/[^\d.]/g, '')) * 100);
      const cover = req.files?.cover?.[0];
      const audio = req.files?.audio?.[0];
      run(
        `INSERT INTO beats (title, genre, bpm, musical_key, price_cents, description, cover_image, audio_file, is_published)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        title,
        String(req.body.genre || '').trim() || null,
        req.body.bpm ? Number(req.body.bpm) : null,
        String(req.body.musical_key || '').trim() || null,
        Number.isFinite(price) ? price : 0,
        String(req.body.description || '').trim() || null,
        safeImageValue(req.body.cover_url) || rel(cover),
        rel(audio),
        req.body.is_published === 'on' ? 1 : 0
      );
      flash(req, 'success', `“${title}” added to the store.`);
      res.redirect('/admin/beats');
    } catch (err) {
      next(err);
    }
  });

  router.post('/beats/:id/update', uploader.fields([{ name: 'cover', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), (req, res, next) => {
    try {
      const beat = get('SELECT * FROM beats WHERE id = ?', Number(req.params.id));
      if (!beat) return next();
      const price = Math.round(parseFloat(String(req.body.price || '0').replace(/[^\d.]/g, '')) * 100);
      const cover = req.files?.cover?.[0];
      const audio = req.files?.audio?.[0];
      run(
        `UPDATE beats SET title = ?, genre = ?, bpm = ?, musical_key = ?, price_cents = ?,
                description = ?, cover_image = ?, audio_file = ?, is_published = ? WHERE id = ?`,
        String(req.body.title || beat.title).trim(),
        String(req.body.genre || '').trim() || null,
        req.body.bpm ? Number(req.body.bpm) : null,
        String(req.body.musical_key || '').trim() || null,
        Number.isFinite(price) ? price : beat.price_cents,
        String(req.body.description || '').trim() || null,
        safeImageValue(req.body.cover_url) || rel(cover) || beat.cover_image,
        rel(audio) || beat.audio_file,
        req.body.is_published === 'on' ? 1 : 0,
        beat.id
      );
      flash(req, 'success', `“${req.body.title || beat.title}” updated.`);
      res.redirect('/admin/beats');
    } catch (err) {
      next(err);
    }
  });

  router.post('/beats/:id/delete', (req, res) => {
    const beat = get('SELECT * FROM beats WHERE id = ?', Number(req.params.id));
    if (beat) {
      removeUpload(beat.audio_file);
      removeUpload(beat.cover_image);
      run('DELETE FROM beats WHERE id = ?', beat.id);
      flash(req, 'success', `“${beat.title}” deleted.`);
    }
    res.redirect('/admin/beats');
  });

  /* ---------------------------------------------------------------- videos */
  router.get('/videos', (req, res) => {
    res.render('admin/videos', { title: 'Videos', videos: all('SELECT * FROM videos ORDER BY created_at DESC, id DESC') });
  });

  router.post('/videos', uploader.fields([{ name: 'video', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]), (req, res, next) => {
    try {
      const title = String(req.body.title || '').trim();
      if (!title) {
        flash(req, 'error', 'Give the video a title.');
        return res.redirect('/admin/videos');
      }
      const video = req.files?.video?.[0];
      const thumb = req.files?.thumb?.[0];
      const embed = String(req.body.embed_url || '').trim();
      const kind = video ? 'upload' : embed ? 'embed' : null;
      if (!kind) {
        flash(req, 'error', 'Upload a video file or paste a YouTube / Vimeo link.');
        return res.redirect('/admin/videos');
      }
      run(
        `INSERT INTO videos (title, description, kind, video_file, embed_url, thumb_image, is_published)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        title,
        String(req.body.description || '').trim() || null,
        kind,
        rel(video),
        embed || null,
        safeImageValue(req.body.thumb_url) || rel(thumb),
        req.body.is_published === 'on' ? 1 : 0
      );
      flash(req, 'success', `“${title}” added to the video wall.`);
      res.redirect('/admin/videos');
    } catch (err) {
      next(err);
    }
  });

  router.post('/videos/:id/delete', (req, res) => {
    const video = get('SELECT * FROM videos WHERE id = ?', Number(req.params.id));
    if (video) {
      removeUpload(video.video_file);
      removeUpload(video.thumb_image);
      run('DELETE FROM videos WHERE id = ?', video.id);
      flash(req, 'success', `“${video.title}” deleted.`);
    }
    res.redirect('/admin/videos');
  });

  router.post('/videos/:id/toggle', (req, res) => {
    run('UPDATE videos SET is_published = 1 - is_published WHERE id = ?', Number(req.params.id));
    res.redirect('/admin/videos');
  });

  /* ---------------------------------------------------------------- orders */
  router.get('/orders', (req, res) => {
    const status = ['pending', 'paid', 'failed'].includes(req.query.status) ? req.query.status : 'all';
    const rows = all(
      `SELECT o.*, b.title, u.name AS artist, u.email FROM orders o
         JOIN beats b ON b.id = o.beat_id JOIN users u ON u.id = o.user_id
        ${status === 'all' ? '' : 'WHERE o.status = ?'}
        ORDER BY o.created_at DESC, o.id DESC`,
      ...(status === 'all' ? [] : [status])
    );
    res.render('admin/orders', {
      title: 'Orders & payments',
      orders: rows,
      status,
      licenses: orders.LICENSES,
      providers: payments.PROVIDERS,
      revenue: rows.filter((r) => r.status === 'paid').reduce((s, r) => s + r.amount_cents, 0),
    });
  });

  router.post('/orders/:reference/confirm', async (req, res, next) => {
    try {
      await markPaid(req, req.params.reference);
      flash(req, 'success', `Order ${req.params.reference} marked paid — the download email has been sent.`);
      res.redirect('/admin/orders');
    } catch (err) {
      next(err);
    }
  });

  router.post('/orders/:reference/fail', (req, res) => {
    run("UPDATE orders SET status = 'failed' WHERE reference = ? AND status = 'pending'", req.params.reference);
    flash(req, 'success', `Order ${req.params.reference} marked failed.`);
    res.redirect('/admin/orders');
  });

  /* -------------------------------------------------------------- messages */
  router.get('/messages', (req, res) => {
    const threads = all(
      `SELECT u.id, u.name, u.email,
              (SELECT body FROM messages m WHERE m.user_id = u.id ORDER BY m.id DESC LIMIT 1) AS last_body,
              (SELECT created_at FROM messages m WHERE m.user_id = u.id ORDER BY m.id DESC LIMIT 1) AS last_at,
              (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.id AND m.sender = 'artist' AND m.read_by_admin = 0) AS unread
         FROM users u
        WHERE u.role = 'artist' AND EXISTS (SELECT 1 FROM messages m WHERE m.user_id = u.id)
        ORDER BY last_at DESC`
    );
    const activeId = req.query.u ? Number(req.query.u) : threads[0]?.id;
    const activeUser = activeId ? get('SELECT id, name, email FROM users WHERE id = ?', activeId) : null;
    const thread = activeUser ? all('SELECT * FROM messages WHERE user_id = ? ORDER BY id ASC', activeUser.id) : [];
    if (activeUser) run("UPDATE messages SET read_by_admin = 1 WHERE user_id = ? AND sender = 'artist'", activeUser.id);
    res.render('admin/messages', { title: 'Messages', threads, activeUser, thread });
  });

  router.post('/messages', async (req, res, next) => {
    try {
      const userId = Number(req.body.user_id);
      const body = String(req.body.body || '').trim();
      const user = get('SELECT * FROM users WHERE id = ?', userId);
      if (!user || !body) {
        flash(req, 'error', 'Pick an artist and write a message.');
        return res.redirect('/admin/messages');
      }
      run("INSERT INTO messages (user_id, sender, body, read_by_admin) VALUES (?, 'producer', ?, 1)", user.id, body.slice(0, 4000));
      await sendMessageEmail(req, {
        to: user.email,
        toName: user.name,
        fromName: process.env.PRODUCER_NAME || 'the producer',
        body,
        userId: user.id,
        toAdmin: false,
      });
      flash(req, 'success', `Reply sent to ${user.name} and emailed to ${user.email}.`);
      res.redirect(`/admin/messages?u=${user.id}`);
    } catch (err) {
      next(err);
    }
  });

  /* --------------------------------------------------------------- mailbox */
  router.get('/mailbox', (req, res) => {
    const category = req.query.category && req.query.category !== 'all' ? req.query.category : null;
    const rows = all(
      `SELECT * FROM mail ${category ? 'WHERE category = ?' : ''} ORDER BY id DESC LIMIT 200`,
      ...(category ? [category] : [])
    );
    const selected = req.query.id ? get('SELECT * FROM mail WHERE id = ?', Number(req.query.id)) : rows[0];
    const categories = all('SELECT category, COUNT(*) c FROM mail GROUP BY category ORDER BY c DESC');
    res.render('admin/mailbox', {
      title: 'Mailbox',
      mails: rows,
      selected,
      category: category || 'all',
      categories,
      smtpOn: isSmtpConfigured(),
    });
  });

  /* -------------------------------------------------------------- settings */
  router.get('/settings', (req, res) => {
    const cfg = smtpConfig();
    res.render('admin/settings', {
      title: 'Settings',
      smtp: { ...cfg, pass: cfg.pass ? '••••••••' : '' },
      smtpOn: isSmtpConfigured(),
      providers: payments.PROVIDERS,
      bank: payments.BANK,
      paymentsMode: payments.MODE,
      delay: payments.DELAY,
    });
  });

  router.post('/settings/smtp', (req, res) => {
    const current = smtpConfig();
    const pass = String(req.body.pass || '').trim();
    const saved = {
      host: String(req.body.host || '').trim(),
      port: String(req.body.port || '587').trim(),
      user: String(req.body.user || '').trim(),
      pass: pass.startsWith('••') ? current.pass : pass,
      secure: req.body.secure === 'on' ? 'true' : 'false',
      from: String(req.body.from || '').trim(),
    };
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('smtp', ?)", JSON.stringify(saved));
    flash(req, 'success', 'SMTP settings saved. New emails will attempt real delivery.');
    res.redirect('/admin/settings');
  });

  router.post('/settings/profile', (req, res) => {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    if (name) run("UPDATE users SET name = ? WHERE role = 'admin'", name);
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      const clash = get('SELECT id FROM users WHERE email = ?', email);
      if (!clash) run("UPDATE users SET email = ? WHERE role = 'admin'", email);
    }
    flash(req, 'success', 'Studio profile updated.');
    res.redirect('/admin/settings');
  });

  return router;
};

function removeUpload(webPath) {
  if (!webPath || !webPath.startsWith('/uploads/')) return;
  const abs = path.join(PUBLIC, webPath);
  if (abs.startsWith(PUBLIC) && fs.existsSync(abs)) fs.unlink(abs, () => {});
}
