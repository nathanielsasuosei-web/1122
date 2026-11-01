'use strict';
/**
 * Long-running entry point (npm start / npm run dev / Docker / Render / Fly).
 * The Express app itself lives in app.js so api/index.js can reuse it.
 */
const app = require('./app');
const payments = require('./lib/payments');
const paths = require('./lib/paths');
const { markPaid } = require('./lib/orders');
const { isSmtpConfigured } = require('./lib/mailer');

const PORT = Number(process.env.PORT || 3000);

// Demo payments that were still pending when the process stopped: re-arm them.
payments.resumePending((ref) => markPaid({ protocol: 'http', get: () => 'localhost' }, ref));

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🎛  Bassline Studio');
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log(`  ➜  storage:  ${paths.STORAGE_DIR}`);
  console.log(`  ➜  payments: ${payments.MODE.toUpperCase()}${payments.MODE === 'demo' ? ` (auto-confirm after ${payments.DELAY / 1000}s)` : ''}`);
  console.log(`  ➜  email:    ${isSmtpConfigured() ? 'SMTP configured' : 'offline mailbox (admin → Mailbox)'}\n`);
});

module.exports = app;
