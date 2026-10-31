'use strict';
const express = require('express');
const { get, run, hashPassword, verifyPassword } = require('../lib/db');
const { send, layout } = require('../lib/mailer');
const orders = require('../lib/orders');

module.exports = ({ flash }) => {
  const router = express.Router();

  router.get('/register', (req, res) => {
    if (res.locals.currentUser) return res.redirect('/dashboard');
    res.render('register', { title: 'Create an artist account', form: {}, next: req.query.next || '' });
  });

  router.post('/register', async (req, res, next) => {
    try {
      const name = String(req.body.name || '').trim();
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      const nextUrl = safeNext(req.body.next);
      const fail = (msg) => {
        flash(req, 'error', msg);
        res.redirect('/register');
      };

      if (name.length < 2) return fail('Please enter your artist or full name.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail('Enter a valid email address — your download links go there.');
      if (password.length < 8) return fail('Use at least 8 characters for your password.');
      if (req.body.password !== req.body.confirm) return fail('The two passwords do not match.');
      if (get('SELECT id FROM users WHERE email = ?', email)) return fail('An account with that email already exists. Try logging in.');

      const info = run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', name, email, hashPassword(password), 'artist');
      req.session.userId = Number(info.lastInsertRowid);

      await send({
        to: email,
        name,
        subject: 'Welcome to Bassline Studio',
        category: 'welcome',
        html: layout({
          heading: `Welcome, ${name.split(' ')[0]} 🎧`,
          intro: 'Your artist account is ready. Preview beats, buy a licence with Mobile Money or bank transfer, and your download lands in your inbox the moment payment clears.',
          body: `<ul style="color:#cbbfe0;font-size:14px;line-height:1.9;padding-left:18px;margin:0">
            <li>Untagged MP3 / WAV downloads</li>
            <li>Instant email delivery + saved order history</li>
            <li>Direct line to the producer in your dashboard</li>
          </ul>`,
          cta: { url: `${orders.baseUrl(req)}/beats`, label: 'Browse the beat store' },
        }),
        text: `Welcome to Bassline Studio, ${name}. Browse beats: ${orders.baseUrl(req)}/beats`,
      });

      flash(req, 'success', `Welcome to the studio, ${name.split(' ')[0]}! Check your inbox for a confirmation email.`);
      res.redirect(nextUrl || '/dashboard');
    } catch (err) {
      next(err);
    }
  });

  router.get('/login', (req, res) => {
    if (res.locals.currentUser) return res.redirect(res.locals.isAdmin ? '/admin' : '/dashboard');
    res.render('login', { title: 'Log in', form: {}, next: req.query.next || '' });
  });

  router.post('/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const nextUrl = safeNext(req.body.next);
    const user = get('SELECT * FROM users WHERE email = ?', email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      flash(req, 'error', 'Email or password is incorrect.');
      return res.redirect('/login');
    }
    req.session.userId = user.id;
    flash(req, 'success', `Welcome back, ${user.name.split(' ')[0]}.`);
    if (nextUrl) return res.redirect(nextUrl);
    res.redirect(user.role === 'admin' ? '/admin' : '/dashboard');
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
  });

  return router;
};

function safeNext(value) {
  const v = String(value || '');
  return v.startsWith('/') && !v.startsWith('//') ? v : '';
}
