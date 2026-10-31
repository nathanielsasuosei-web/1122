'use strict';
/**
 * Email service.
 *
 * If SMTP credentials are configured (env vars or the admin Settings tab) mail
 * is delivered for real with nodemailer. Otherwise every email is still built
 * and stored in the `mail` table, so the whole purchase / notification flow is
 * fully testable offline and readable in the admin Mailbox tab.
 */
const nodemailer = require('nodemailer');
const { all, get, run } = require('./db');

const BRAND = {
  name: process.env.STUDIO_NAME || 'Bassline Studio',
  accent: '#ff3d8b',
  violet: '#8b5cf6',
  cyan: '#22d3ee',
};

function smtpConfig() {
  const row = get("SELECT value FROM settings WHERE key = 'smtp'");
  let saved = {};
  try { saved = row ? JSON.parse(row.value) : {}; } catch { saved = {}; }
  const cfg = {
    host: process.env.SMTP_HOST || saved.host || '',
    port: Number(process.env.SMTP_PORT || saved.port || 587),
    user: process.env.SMTP_USER || saved.user || '',
    pass: process.env.SMTP_PASS || saved.pass || '',
    secure: String(process.env.SMTP_SECURE || saved.secure || 'false') === 'true',
    from: process.env.MAIL_FROM || saved.from || `Bassline Studio <no-reply@bassline.studio>`,
  };
  return cfg;
}

function isSmtpConfigured() {
  const c = smtpConfig();
  return Boolean(c.host && c.user && c.pass);
}

let transporter = null;
let transporterKey = '';
function getTransporter() {
  const c = smtpConfig();
  if (!isSmtpConfigured()) return null;
  const key = `${c.host}:${c.port}:${c.user}:${c.secure}`;
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: { user: c.user, pass: c.pass },
    });
    transporterKey = key;
  }
  return transporter;
}

/** HTML wrapper shared by every transactional email. */
function layout({ heading, intro, body, cta, footer }) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0a0710;font-family:'Helvetica Neue',Arial,sans-serif;color:#f4f0ff">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0710;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#140d20;border:1px solid #2a1c3d;border-radius:18px;overflow:hidden">
        <tr><td style="padding:26px 30px;background:linear-gradient(120deg,${BRAND.accent},${BRAND.violet} 55%,${BRAND.cyan})">
          <div style="font-size:19px;font-weight:800;letter-spacing:.6px;color:#fff">${BRAND.name}</div>
          <div style="font-size:12px;color:rgba(255,255,255,.85);letter-spacing:2.4px;text-transform:uppercase;margin-top:4px">beats · licences · studio</div>
        </td></tr>
        <tr><td style="padding:30px">
          <h1 style="margin:0 0 12px;font-size:23px;line-height:1.3;color:#fff">${heading}</h1>
          ${intro ? `<p style="margin:0 0 20px;color:#cbbfe0;font-size:15px;line-height:1.65">${intro}</p>` : ''}
          ${body || ''}
          ${cta ? `<p style="margin:26px 0 0"><a href="${cta.url}" style="display:inline-block;background:${BRAND.accent};color:#fff;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:999px;font-size:14px">${cta.label}</a></p>` : ''}
        </td></tr>
        <tr><td style="padding:18px 30px;border-top:1px solid #241733;color:#7d6f96;font-size:12px;line-height:1.6">
          ${footer || `You are receiving this because you have an account at ${BRAND.name}.`}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const money = (cents) => `GH₵ ${(cents / 100).toFixed(2)}`;

/** Persist + (optionally) deliver an email. Never throws. */
async function send({ to, name, subject, html, text, category = 'general' }) {
  const info = run(
    'INSERT INTO mail (to_email, to_name, subject, html, text, category) VALUES (?, ?, ?, ?, ?, ?)',
    to, name || null, subject, html, text || null, category
  );
  const id = Number(info.lastInsertRowid);
  const tx = getTransporter();
  if (!tx) {
    console.log(`  ✉  [mailbox] ${subject} → ${to}`);
    return { id, delivered: false };
  }
  try {
    await tx.sendMail({ from: smtpConfig().from, to, subject, html, text });
    run('UPDATE mail SET sent = 1 WHERE id = ?', id);
    console.log(`  ✉  [smtp] ${subject} → ${to}`);
    return { id, delivered: true };
  } catch (err) {
    run('UPDATE mail SET error = ? WHERE id = ?', String(err.message || err), id);
    console.error(`  ✉  [smtp error] ${to}: ${err.message}`);
    return { id, delivered: false, error: err.message };
  }
}
module.exports = { send, layout, isSmtpConfigured, smtpConfig };
