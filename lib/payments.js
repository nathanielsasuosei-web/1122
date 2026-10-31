'use strict';
/**
 * Payment layer.
 *
 * DEMO MODE (PAYMENTS_MODE=demo, the default) simulates a Mobile Money or bank
 * transfer: the order is created as `pending`, then automatically confirmed
 * after DEMO_PAYMENT_DELAY_MS milliseconds, which triggers the paid + sale
 * emails and unlocks the download link.
 *
 * To go live, implement `initiateCharge` against your PSP (Paystack, Hubtel,
 * Flutterwave, MTN MoMo API ...) and call `markPaid(reference)` from the
 * webhook. Keep the rest of the flow untouched.
 */
const { get, all, run } = require('./db');

const MODE = process.env.PAYMENTS_MODE || 'demo';
const DELAY = Number(process.env.DEMO_PAYMENT_DELAY_MS || 6000);

const PROVIDERS = {
  mtn: { label: 'MTN Mobile Money', hint: '024 123 4567' },
  vodafone: { label: 'Telecel Cash', hint: '020 123 4567' },
  airteltigo: { label: 'AirtelTigo Money', hint: '027 123 4567' },
};

const BANK = {
  bank: process.env.BANK_NAME || 'Ecobank Ghana',
  account_name: process.env.BANK_ACCOUNT_NAME || 'Bassline Studio',
  account_number: process.env.BANK_ACCOUNT_NUMBER || '1441 0023 4567 89',
  branch: process.env.BANK_BRANCH || 'Osu, Accra',
  swift: process.env.BANK_SWIFT || 'ECOCGHAC',
};

const timers = new Map();

/** Queues the demo confirmation. In live mode this would call the PSP instead. */
function scheduleDemoConfirmation(reference, onPaid) {
  if (MODE === 'live') return;
  clearTimeout(timers.get(reference));
  const t = setTimeout(async () => {
    timers.delete(reference);
    const order = get('SELECT * FROM orders WHERE reference = ?', reference);
    if (!order || order.status !== 'pending') return;
    await onPaid(reference);
  }, DELAY);
  if (t.unref) t.unref();          // never keep the process alive
  timers.set(reference, t);
  // Also persist the target so a server restart can re-arm pending orders.
  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_demo_ref', ?)", reference);
}

/** Re-arms demo confirmations for orders left pending by a restart. */
function resumePending(onPaid) {
  if (MODE === 'live') return;
  const rows = all("SELECT reference FROM orders WHERE status = 'pending'");
  for (const row of rows) scheduleDemoConfirmation(row.reference, onPaid);
  if (rows.length) console.log(`  ↳ Re-armed ${rows.length} pending demo payment(s).`);
}

module.exports = { MODE, DELAY, PROVIDERS, BANK, scheduleDemoConfirmation, resumePending };
