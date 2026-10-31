'use strict';
const express = require('express');
const { all, get, run } = require('../lib/db');
const { LICENSES, sendMessageEmail, markPaid } = require('../lib/orders');
const payments = require('../lib/payments');

module.exports = ({ flash }) => {
  const router = express.Router();

  router.use((req, res, next) => {
    const user = res.locals.currentUser;
    if (!user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (user.role === 'admin') return res.redirect('/admin');
    next();
  });

  router.get('/', (req, res) => {
    const user = res.locals.currentUser;
    const orders = all(
      `SELECT o.*, b.title, b.cover_image, b.audio_file, b.bpm, b.musical_key, b.genre
         FROM orders o JOIN beats b ON b.id = o.beat_id
        WHERE o.user_id = ? ORDER BY o.created_at DESC, o.id DESC`,
      user.id
    );
    const unread = get(
      "SELECT COUNT(*) c FROM messages WHERE user_id = ? AND sender = 'producer' AND read_by_artist = 0",
      user.id
    ).c;
    res.render('artist/dashboard', {
      title: 'Your dashboard',
      orders,
      unread,
      spent: orders.filter((o) => o.status === 'paid').reduce((s, o) => s + o.amount_cents, 0),
      licenses: LICENSES,
    });
  });

  router.get('/orders/:reference', async (req, res, next) => {
    const user = res.locals.currentUser;
    // Settle a demo payment that came due while the server was busy or frozen.
    const own = get('SELECT * FROM orders WHERE reference = ? AND user_id = ?', req.params.reference, user.id);
    if (own && payments.isDue(own)) await markPaid(req, own.reference);
    const order = get(
      `SELECT o.*, b.title, b.cover_image, b.audio_file, b.bpm, b.musical_key, b.genre, b.description
         FROM orders o JOIN beats b ON b.id = o.beat_id
        WHERE o.reference = ? AND o.user_id = ?`,
      req.params.reference, user.id
    );
    if (!order) return next();
    res.render('artist/order', { title: `Order ${order.reference}`, order, licenses: LICENSES });
  });

  /* ------------------------------------------------------------- messages */
  router.get('/messages', (req, res) => {
    const user = res.locals.currentUser;
    const thread = all('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC, id ASC', user.id);
    run("UPDATE messages SET read_by_artist = 1 WHERE user_id = ? AND sender = 'producer'", user.id);
    res.render('artist/messages', { title: 'Messages', thread });
  });

  router.post('/messages', async (req, res, next) => {
    try {
      const user = res.locals.currentUser;
      const body = String(req.body.body || '').trim();
      if (!body) {
        flash(req, 'error', 'Write a message first.');
        return res.redirect('/dashboard/messages');
      }
      run("INSERT INTO messages (user_id, sender, body, read_by_artist) VALUES (?, 'artist', ?, 1)", user.id, body.slice(0, 4000));
      const adminEmail = process.env.ADMIN_EMAIL || get("SELECT email FROM users WHERE role = 'admin'").email;
      await sendMessageEmail(req, {
        to: adminEmail,
        toName: process.env.PRODUCER_NAME || 'Producer',
        fromName: `${user.name} (${user.email})`,
        body,
        userId: user.id,
        toAdmin: true,
      });
      flash(req, 'success', 'Message sent. The producer has been emailed.');
      res.redirect('/dashboard/messages');
    } catch (err) {
      next(err);
    }
  });

  return router;
};
