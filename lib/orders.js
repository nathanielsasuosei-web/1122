'use strict';
/**
 * Order lifecycle: create → (payment) → paid → emailed download link.
 * All email side-effects live here so the flow is identical for demo payments,
 * manual admin confirmation, and future PSP webhooks.
 */
const { get, run, token } = require('./db');
const { send, layout } = require('./mailer');
const payments = require('./payments');

const money = (cents) => `GH₵ ${(cents / 100).toFixed(2)}`;
const LICENSES = {
  lease: { label: 'Lease (MP3)', multiplier: 1, blurb: 'Untagged MP3, up to 100,000 streams, non-exclusive.' },
  premium: { label: 'Premium (WAV)', multiplier: 2, blurb: 'Untagged WAV + MP3, up to 500,000 streams, non-exclusive.' },
  exclusive: { label: 'Exclusive (stems)', multiplier: 6, blurb: 'Full exclusive rights plus trackout stems. Beat is retired from the store.' },
};

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function priceFor(beat, license) {
  const mult = (LICENSES[license] || LICENSES.lease).multiplier;
  return Math.round(beat.price_cents * mult);
}

function newReference() {
  return `BL-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`;
}

/* --------------------------------------------------------------- emails */
async function sendOrderReceived(req, order, beat, user) {
  const method =
    order.method === 'bank'
      ? `bank transfer to ${payments.BANK.bank} • ${payments.BANK.account_number}`
      : `${payments.PROVIDERS[order.provider]?.label || 'Mobile Money'} from ${order.account_number}`;
  return send({
    to: user.email,
    name: user.name,
    subject: `Order ${order.reference} received — ${beat.title}`,
    category: 'order',
    html: layout({
      heading: 'Your order is pending payment',
      intro: `Hi ${user.name}, thanks for grabbing <strong>${beat.title}</strong>. We're waiting on your payment to clear.`,
      body: `<table role="presentation" width="100%" style="font-size:14px;color:#cbbfe0">
        <tr><td style="padding:7px 0">Order</td><td align="right" style="color:#fff;font-weight:700">${order.reference}</td></tr>
        <tr><td style="padding:7px 0">Beat</td><td align="right" style="color:#fff">${beat.title}</td></tr>
        <tr><td style="padding:7px 0">Licence</td><td align="right" style="color:#fff">${LICENSES[order.license]?.label || order.license}</td></tr>
        <tr><td style="padding:7px 0">Amount</td><td align="right" style="color:#ff3d8b;font-weight:700">${money(order.amount_cents)}</td></tr>
        <tr><td style="padding:7px 0">Method</td><td align="right" style="color:#fff">${method}</td></tr>
      </table>
      <p style="margin:18px 0 0;color:#8f82a8;font-size:13px">You'll get the download link the moment the payment is confirmed.</p>`,
      cta: { url: `${baseUrl(req)}/dashboard/orders/${order.reference}`, label: 'Track this order' },
    }),
    text: `Order ${order.reference} for ${beat.title} (${money(order.amount_cents)}) is pending. Method: ${method}.`,
  });
}

async function sendPaidAndSale(req, order, beat, user) {
  const link = `${baseUrl(req)}/download/${order.download_token}`;
  await Promise.all([
    // 1. buyer gets the download
    send({
      to: user.email,
      name: user.name,
      subject: `Payment confirmed — download “${beat.title}”`,
      category: 'payment',
      html: layout({
        heading: 'Payment confirmed 🎉',
        intro: `Hi ${user.name}, your payment of <strong>${money(order.amount_cents)}</strong> for <strong>${beat.title}</strong> has cleared. The beat is yours — download it below.`,
        body: `<div style="background:#0e0818;border:1px solid #2a1c3d;border-radius:12px;padding:16px;font-size:13px;color:#cbbfe0">
            <div style="color:#fff;font-weight:700;margin-bottom:6px">${beat.title}${beat.bpm ? ` · ${beat.bpm} BPM` : ''}${beat.musical_key ? ` · ${beat.musical_key}` : ''}</div>
            ${LICENSES[order.license]?.blurb || ''}<br>
            Order ${order.reference} · ${LICENSES[order.license]?.label || order.license}
          </div>
          <p style="margin:16px 0 0;color:#8f82a8;font-size:13px">Keep this email — the link is personal and stays active, and you can always download again from your dashboard.</p>`,
        cta: { url: link, label: '⬇ Download your beat' },
        footer: `Link doesn't work? Copy this into your browser: ${link}`,
      }),
      text: `Payment confirmed for ${beat.title} (${money(order.amount_cents)}, order ${order.reference}). Download: ${link}`,
    }),
    // 2. producer gets the sale notification
    send({
      to: process.env.ADMIN_EMAIL || 'admin@bassline.studio',
      name: process.env.PRODUCER_NAME || 'Producer',
      subject: `💰 New sale — ${beat.title} · ${money(order.amount_cents)}`,
      category: 'sale',
      html: layout({
        heading: 'You made a sale',
        intro: `<strong>${user.name}</strong> (${user.email}) just bought <strong>${beat.title}</strong>.`,
        body: `<table role="presentation" width="100%" style="font-size:14px;color:#cbbfe0">
          <tr><td style="padding:7px 0">Amount</td><td align="right" style="color:#22d3ee;font-weight:700">${money(order.amount_cents)}</td></tr>
          <tr><td style="padding:7px 0">Licence</td><td align="right" style="color:#fff">${LICENSES[order.license]?.label || order.license}</td></tr>
          <tr><td style="padding:7px 0">Method</td><td align="right" style="color:#fff">${order.method === 'bank' ? 'Bank transfer' : payments.PROVIDERS[order.provider]?.label || 'Mobile Money'}</td></tr>
          <tr><td style="padding:7px 0">Order</td><td align="right" style="color:#fff">${order.reference}</td></tr>
        </table>`,
        cta: { url: `${baseUrl(req)}/admin/orders`, label: 'Open producer area' },
      }),
      text: `New sale: ${beat.title} for ${money(order.amount_cents)} by ${user.name} (${user.email}). Order ${order.reference}.`,
    }),
  ]);
}

async function sendMessageEmail(req, { to, toName, fromName, body, userId, toAdmin }) {
  return send({
    to,
    name: toName,
    subject: toAdmin ? `New message from ${fromName}` : `New message from the studio`,
    category: 'message',
    html: layout({
      heading: toAdmin ? 'New message in your studio inbox' : 'You have a new message',
      intro: toAdmin
        ? `<strong>${fromName}</strong> sent you a message.`
        : `The producer replied to your conversation, ${fromName}.`,
      body: `<div style="background:#0e0818;border-left:3px solid #ff3d8b;border-radius:8px;padding:16px;color:#e7dff5;font-size:14px;line-height:1.65">${escapeHtml(
        body
      ).replace(/\n/g, '<br>')}</div>`,
      cta: {
        url: `${baseUrl(req)}${toAdmin ? '/admin/messages' : `/dashboard/messages?u=${userId}`}`,
        label: toAdmin ? 'Reply in the producer area' : 'Reply in your dashboard',
      },
      footer: 'Replying to this email does not reach the studio — use the dashboard to keep the thread together.',
    }),
    text: body,
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------ the flow */
async function createOrder(req, { user, beat, license, method, provider, accountNumber }) {
  const amount = priceFor(beat, license);
  const reference = newReference();
  const download_token = token(24);
  run(
    `INSERT INTO orders (reference, user_id, beat_id, amount_cents, license, method, provider, account_number, status, download_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    reference, user.id, beat.id, amount, license, method, provider || null, accountNumber || null, download_token
  );
  const order = get('SELECT * FROM orders WHERE reference = ?', reference);
  await sendOrderReceived(req, order, beat, user);
  payments.scheduleDemoConfirmation(reference, (ref) => markPaid(req, ref));
  return order;
}

async function markPaid(req, reference) {
  const order = get('SELECT * FROM orders WHERE reference = ?', reference);
  if (!order || order.status === 'paid') return order;
  run("UPDATE orders SET status = 'paid', paid_at = datetime('now') WHERE reference = ?", reference);
  const fresh = get('SELECT * FROM orders WHERE reference = ?', reference);
  const beat = get('SELECT * FROM beats WHERE id = ?', fresh.beat_id);
  const user = get('SELECT * FROM users WHERE id = ?', fresh.user_id);
  if (!beat || !user) return fresh;
  await sendPaidAndSale(req, fresh, beat, user);
  if (fresh.license === 'exclusive') {
    run('UPDATE beats SET is_published = 0 WHERE id = ?', beat.id);
  }
  return fresh;
}

module.exports = { createOrder, markPaid, priceFor, LICENSES, money, sendMessageEmail, escapeHtml, baseUrl };
