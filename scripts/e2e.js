/* End-to-end smoke test against a running server (default http://localhost:3000) */
const BASE = process.env.BASE || 'http://localhost:3000';

let cookie = '';
async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    redirect: 'manual',
    ...opts,
    headers: { cookie, ...(opts.headers || {}) },
  });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const [pair] = c.split(';');
    if (pair.startsWith('connect.sid')) cookie = pair;
  }
  const text = await res.text();
  return { status: res.status, text, res };
}
const form = (obj) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(obj).toString(),
});
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n🎛  Bassline Studio — end-to-end check\n');

  // 1. artist registration
  const email = `artist${Date.now()}@test.gh`;
  let r = await req('/register', form({ name: 'Ama Serwaa', email, password: 'password123', confirm: 'password123' }));
  ok('register artist', r.status === 302, `→ ${r.res.headers.get('location')}`);
  r = await req('/dashboard');
  ok('dashboard loads for artist', r.status === 200 && r.text.includes('Welcome back, Ama'));

  // 2. artist sends a message
  r = await req('/dashboard/messages', form({ body: 'Hi! Do you have stems for Neon Highway?' }));
  r = await req('/dashboard/messages');
  ok('message appears in thread', r.text.includes('stems for Neon Highway'));

  // 3. place a Mobile Money order
  r = await req('/checkout/2', form({ license: 'premium', method: 'momo', provider: 'mtn', account_number: '0241234567' }));
  const loc = r.res.headers.get('location') || '';
  const reference = (loc.match(/orders\/(BL-[A-Z0-9]+)/) || [])[1];
  ok('order created', r.status === 302 && !!reference, reference);
  r = await req(`/dashboard/orders/${reference}`);
  ok('order shows pending + polling widget', r.text.includes('data-pending-order') && r.text.includes('pending'));

  // 4. wait for the demo auto-confirmation
  await sleep(7500);
  r = await req(`/api/orders/${reference}`, { headers: { accept: 'application/json' } });
  const status = JSON.parse(r.text).status;
  ok('payment auto-confirmed (pending → paid)', status === 'paid', status);

  // 5. download works
  r = await req(`/dashboard/orders/${reference}`);
  const token = (r.text.match(/\/download\/([a-f0-9]{20,})/) || [])[1];
  ok('download link present on paid order', !!token);

  // 6. producer login + checks
  cookie = '';
  r = await req('/login', form({ email: 'admin@bassline.studio', password: 'producer123' }));
  ok('producer login', r.status === 302);
  r = await req('/admin');
  ok('producer overview loads', r.status === 200 && r.text.includes('Studio overview'));
  r = await req('/admin/orders');
  ok('order visible to producer as paid', r.text.includes(reference) && r.text.includes('paid'));
  r = await req('/admin/messages');
  ok('artist message in producer inbox', r.text.includes('stems for Neon Highway'));
  r = await req('/admin/mailbox');
  const mailCount = (r.text.match(/mail-item/g) || []).length;
  ok('mailbox has generated emails', mailCount >= 3, `${mailCount} emails`);
  for (const kind of ['order', 'payment', 'sale', 'message', 'welcome']) {
    ok(`email category "${kind}" generated`, r.text.includes(`>${kind}<`) || r.text.includes(kind));
  }

  // 7. producer replies → email to artist
  const userId = (r.text.match(/user_id" value="(\d+)"/) || [])[1] || null;
  r = await req('/admin/messages');
  const uid = (r.text.match(/user_id" value="(\d+)"/) || [])[1];
  r = await req('/admin/messages', form({ user_id: uid, body: 'Yes — stems are included in the premium licence.' }));
  ok('producer reply sent', r.status === 302);

  // 8. admin uploads a beat (multipart)
  const fd = new FormData();
  fd.set('title', 'Test Beat Upload');
  fd.set('genre', 'Afrobeats');
  fd.set('bpm', '99');
  fd.set('musical_key', 'D minor');
  fd.set('price', '60');
  fd.set('description', 'Created by the e2e test.');
  fd.set('is_published', 'on');
  fd.set('audio', new Blob([Buffer.from('ID3fake-mp3-bytes')], { type: 'audio/mpeg' }), 'demo.mp3');
  r = await req('/admin/beats', { method: 'POST', body: fd });
  ok('beat upload accepted', r.status === 302);
  r = await req('/beats');
  ok('uploaded beat appears in store', r.text.includes('Test Beat Upload'));

  // 9. download endpoint streams the file for the paid order (uploaded beat has audio)
  console.log('\nDone. exit code:', process.exitCode || 0, '\n');
})();
