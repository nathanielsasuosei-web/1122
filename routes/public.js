'use strict';
const express = require('express');
const path = require('path');
const { all, get, run } = require('../lib/db');
const orders = require('../lib/orders');
const payments = require('../lib/payments');
const paths = require('../lib/paths');

module.exports = ({ flash }) => {
  const router = express.Router();

  const publishedBeats = () => all('SELECT * FROM beats WHERE is_published = 1 ORDER BY created_at DESC, id DESC');
  const publishedVideos = () => all('SELECT * FROM videos WHERE is_published = 1 ORDER BY created_at DESC, id DESC');

  router.get('/', (req, res) => {
    const beats = publishedBeats();
    res.render('home', {
      title: 'Beats, licences & studio',
      beats,
      videos: publishedVideos(),
      stats: {
        beats: beats.length,
        artists: get("SELECT COUNT(*) c FROM users WHERE role = 'artist'").c,
        sales: get("SELECT COUNT(*) c FROM orders WHERE status = 'paid'").c,
      },
    });
  });

  router.get('/beats', (req, res) => {
    const { genre, q, sort } = req.query;
    let beats = publishedBeats();
    if (genre && genre !== 'all') beats = beats.filter((b) => b.genre === genre);
    if (q) {
      const needle = String(q).toLowerCase();
      beats = beats.filter((b) =>
        [b.title, b.genre, b.musical_key].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle))
      );
    }
    if (sort === 'low') beats.sort((a, b) => a.price_cents - b.price_cents);
    if (sort === 'high') beats.sort((a, b) => b.price_cents - a.price_cents);
    if (sort === 'bpm') beats.sort((a, b) => (a.bpm || 0) - (b.bpm || 0));
    const genres = [...new Set(publishedBeats().map((b) => b.genre).filter(Boolean))].sort();
    res.render('beats', { title: 'Beat store', beats, genres, filters: { genre: genre || 'all', q: q || '', sort: sort || 'new' } });
  });

  router.get('/beats/:id', (req, res, next) => {
    const beat = get('SELECT * FROM beats WHERE id = ?', Number(req.params.id));
    if (!beat || (!beat.is_published && !res.locals.isAdmin)) return next();
    const related = all(
      'SELECT * FROM beats WHERE is_published = 1 AND genre = ? AND id <> ? LIMIT 3',
      beat.genre || '', beat.id
    );
    res.render('beat', { title: beat.title, beat, related, licenses: orders.LICENSES });
  });

  router.get('/videos', (req, res) => {
    res.render('videos', { title: 'Videos', videos: publishedVideos() });
  });

  router.get('/about', (req, res) => {
    res.render('about', {
      title: 'About the studio',
      beats: get('SELECT COUNT(*) c FROM beats').c,
      videos: get('SELECT COUNT(*) c FROM videos').c,
    });
  });

  /* ------------------------------------------------------------ checkout */
  router.get('/checkout/:id', (req, res, next) => {
    if (!res.locals.currentUser) return res.redirect(`/login?next=/checkout/${req.params.id}`);
    const beat = get('SELECT * FROM beats WHERE id = ?', Number(req.params.id));
    if (!beat || !beat.is_published) return next();
    const license = orders.LICENSES[req.query.license] ? req.query.license : 'lease';
    res.render('checkout', {
      title: `Checkout — ${beat.title}`,
      beat,
      license,
      licenses: orders.LICENSES,
      providers: payments.PROVIDERS,
      bank: payments.BANK,
      prices: Object.fromEntries(Object.keys(orders.LICENSES).map((k) => [k, orders.priceFor(beat, k)])),
      demoDelay: payments.DELAY,
      demoMode: payments.MODE === 'demo',
    });
  });

  router.post('/checkout/:id', async (req, res, next) => {
    try {
      const user = res.locals.currentUser;
      if (!user) return res.redirect('/login');
      const beat = get('SELECT * FROM beats WHERE id = ?', Number(req.params.id));
      if (!beat || !beat.is_published) return res.status(404).render('error', { title: 'Not found', code: 404, message: 'That beat is no longer available.' });

      const license = orders.LICENSES[req.body.license] ? req.body.license : 'lease';
      const method = req.body.method === 'bank' ? 'bank' : 'momo';
      const provider = method === 'momo' ? (req.body.provider || 'mtn') : null;
      const accountNumber = method === 'momo' ? String(req.body.account_number || '').trim() : null;

      if (method === 'momo' && !/^0\d{9}$/.test(accountNumber || '')) {
        flash(req, 'error', 'Enter a valid 10-digit Mobile Money number, e.g. 0241234567.');
        return res.redirect(`/checkout/${beat.id}?license=${license}`);
      }
      if (!payments.PROVIDERS[provider] && method === 'momo') {
        flash(req, 'error', 'Choose a Mobile Money network.');
        return res.redirect(`/checkout/${beat.id}?license=${license}`);
      }

      const order = await orders.createOrder(req, {
        user,
        beat,
        license,
        method,
        provider,
        accountNumber,
      });
      flash(req, 'success', `Order ${order.reference} created. ${payments.MODE === 'demo' ? 'Demo payment confirming automatically…' : 'Complete the payment to unlock your download.'}`);
      res.redirect(`/dashboard/orders/${order.reference}`);
    } catch (err) {
      next(err);
    }
  });

  /* ------------------------------------------------- manual bank notice */
  router.post('/orders/:reference/proof', (req, res, next) => {
    const user = res.locals.currentUser;
    if (!user) return res.redirect('/login');
    const order = get('SELECT * FROM orders WHERE reference = ? AND user_id = ?', req.params.reference, user.id);
    if (!order) return next();
    flash(req, 'success', 'Thanks — we noted that you have sent the transfer. The studio will confirm it shortly.');
    res.redirect(`/dashboard/orders/${order.reference}`);
  });

  /* ------------------------------------------------ order status polling */
  router.get('/api/orders/:reference', async (req, res, next) => {
    try {
      const user = res.locals.currentUser;
      if (!user) return res.status(401).json({ error: 'auth required' });
      let order = get('SELECT * FROM orders WHERE reference = ?', req.params.reference);
      if (!order || (order.user_id !== user.id && user.role !== 'admin')) {
        return res.status(404).json({ error: 'not found' });
      }
      // Serverless-safe demo confirmation: the timer may have been frozen, so
      // settle a due order right here instead of trusting setTimeout alone.
      if (payments.isDue(order)) {
        await orders.markPaid(req, order.reference);
        order = get('SELECT * FROM orders WHERE reference = ?', order.reference);
      }
      res.json({ reference: order.reference, status: order.status, paid_at: order.paid_at });
    } catch (err) {
      next(err);
    }
  });

  /* ------------------------------------------------------------ download */
  router.get('/download/:token', (req, res, next) => {
    const order = get('SELECT * FROM orders WHERE download_token = ?', req.params.token);
    if (!order) return res.status(404).render('error', { title: 'Invalid link', code: 404, message: 'This download link is not valid.' });
    if (order.status !== 'paid') {
      return res.status(402).render('error', {
        title: 'Payment pending',
        code: 402,
        message: 'This order has not been paid yet, so the download is still locked. Check your email or dashboard in a moment.',
      });
    }
    const beat = get('SELECT * FROM beats WHERE id = ?', order.beat_id);
    if (!beat || !beat.audio_file) {
      return res.status(404).render('error', { title: 'File missing', code: 404, message: 'The audio file for this beat has not been uploaded yet. Contact the studio.' });
    }
    run('UPDATE orders SET download_count = download_count + 1 WHERE id = ?', order.id);
    const abs = paths.resolveUpload(beat.audio_file);
    if (!abs) {
      return res.status(404).render('error', { title: 'File missing', code: 404, message: 'The audio file could not be found on disk.' });
    }
    const ext = path.extname(abs);
    const safeName = `${beat.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${order.license}${ext}`;
    res.download(abs, safeName);
  });

  return router;
};
