'use strict';
/**
 * The Express application itself — no `listen()` call, so the same code can be
 * mounted by server.js (long-running host) or by api/index.js (Vercel).
 */
const path = require('path');
const express = require('express');
const session = require('express-session');
const paths = require('./lib/paths');
const { get, seed } = require('./lib/db');
const { isSmtpConfigured } = require('./lib/mailer');
const payments = require('./lib/payments');
const { SQLiteStore } = require('./lib/session-store');

seed();

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/** Health probe for Render/Railway/Fly/Docker/Vercel uptime checks. */
app.get('/healthz', (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()), storage: paths.STORAGE_DIR });
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      // Uploaded beats/videos must be seekable from the browser.
      if (/[\\/](audio|video)[\\/]/.test(filePath)) res.setHeader('Accept-Ranges', 'bytes');
    },
  })
);
// New uploads may live outside public/ (e.g. /tmp or a mounted volume).
if (paths.UPLOAD_DIR !== paths.BUNDLED_UPLOADS) {
  app.use(
    '/uploads',
    express.static(paths.UPLOAD_DIR, {
      setHeaders(res) {
        res.setHeader('Accept-Ranges', 'bytes');
      },
    })
  );
}

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'bassline-studio-dev-secret',
    store: new SQLiteStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 14,
      secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false' ? 'auto' : false,
    },
  })
);

/* ------------------------------------------------------- view locals */
app.use((req, res, next) => {
  const userId = req.session.userId;
  res.locals.currentUser = userId ? get('SELECT id, name, email, role FROM users WHERE id = ?', userId) : null;
  res.locals.isAdmin = res.locals.currentUser?.role === 'admin';
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.path = req.path;
  res.locals.studio = {
    name: process.env.STUDIO_NAME || 'Bassline Studio',
    producer: process.env.PRODUCER_NAME || 'Kobby Waves',
    tagline: process.env.STUDIO_TAGLINE || 'Beats engineered in Accra. Licensed worldwide.',
    email: process.env.STUDIO_EMAIL || 'hello@bassline.studio',
  };
  res.locals.demoMode = payments.MODE !== 'live';
  res.locals.money = (c) => `GH₵ ${(Number(c) / 100).toFixed(2)}`;
  res.locals.smtpOn = isSmtpConfigured();
  next();
});

function flash(req, type, message) {
  req.session.flash = { type, message };
}

/* ------------------------------------------------------------- routes */
const publicRoutes = require('./routes/public')({ flash });
const authRoutes = require('./routes/auth')({ flash });
const dashboardRoutes = require('./routes/dashboard')({ flash });
const adminRoutes = require('./routes/admin')({ flash });

app.use('/', publicRoutes);
app.use('/', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/admin', adminRoutes);

/* ------------------------------------------------------------- errors */
app.use((req, res) => {
  res.status(404).render('error', { title: 'Page not found', code: 404, message: 'That page took a different beat.' });
});
app.use((err, req, res, next) => {
  console.error(err);
  const message =
    err.code === 'LIMIT_FILE_SIZE'
      ? 'That file is too large. Covers ≤ 8 MB, audio ≤ 40 MB, video ≤ 120 MB.'
      : err.message || 'Something went wrong.';
  if (req.accepts('html')) {
    res.status(err.status || 500).render('error', { title: 'Error', code: err.status || 500, message });
  } else {
    res.status(err.status || 500).json({ error: message });
  }
});

module.exports = app;
