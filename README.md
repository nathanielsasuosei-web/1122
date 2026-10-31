# 🎛 Bassline Studio

A complete beat-selling website for a music producer: a public storefront, artist accounts,
Mobile Money & bank-transfer checkout, automatic email delivery of purchased beats, and a
producer admin area for uploading beats and videos.

Built with **Node.js + Express + SQLite** (`node:sqlite`, zero native builds) and server-rendered
**EJS** templates. No front-end build step, no external database.

```
npm install
npm start          # → http://localhost:3000
```

On first run the app creates the database, an admin account and four demo beats
(cover art + playable audio previews included).

| Role | Email | Password |
| --- | --- | --- |
| Producer / admin | `admin@bassline.studio` | `producer123` |
| Artist | create your own at `/register` | — |

> Change the admin password in `.env` **before** the first run (it is only used when the admin
> account is first created). Delete `data/producer.db*` to start over.

---

## What it does

### Storefront
- **Animated equalizer hero** — a live bar visualiser plus a marquee strip, dark theme with pink,
  violet and cyan accents, glassy panels and a sticky bottom player.
- Beat store with search / genre / price / tempo filtering, cover art, BPM and key.
- Per-beat page with the three licences, preview playback, related beats.
- Video wall (uploaded MP4/WebM files or embedded YouTube/Vimeo).
- Sticky global audio player — previews keep playing as you browse.

### Artist accounts (`/register`, `/login`)
- Dashboard with order history, spend, download links and re-downloads.
- Order detail page shows payment status and polls itself: when a demo payment confirms, the
  page flips from *pending* to *paid* and the download unlocks without a reload.
- Messages with the producer — each message also sends an email.

### Payments (Mobile Money + bank)
- **Mobile Money:** MTN, Telecel, AirtelTigo — 10-digit number, validated.
- **Bank transfer:** studio bank details shown at checkout; the artist can flag "I've sent the
  transfer" and the producer confirms it in the admin Orders tab.
- **Demo mode** (`PAYMENTS_MODE=demo`, the default) confirms the order automatically after
  `DEMO_PAYMENT_DELAY_MS` (6 s) so the whole flow can be tested. Set `PAYMENTS_MODE=live` and
  implement your PSP (Paystack, Hubtel, Flutterwave, MTN MoMo …) in `lib/payments.js` —
  call `markPaid(reference)` from the webhook and nothing else changes.

### Email delivery
- Emails generated automatically:
  - **welcome** — on registration
  - **order** — order placed, pending payment (with the payment details)
  - **payment** — payment confirmed, containing the personal download link
  - **sale** — notification to the producer
  - **message** — both directions of every dashboard conversation
- The download link is a token (`/download/<token>`), stored per order and reusable.
- **No SMTP? Nothing is lost.** Emails are stored and browsable in the producer's
  **Mailbox** tab, fully rendered. Add SMTP in **Admin → Settings** (or `.env`) to deliver
  them for real. Gmail requires an app password.

### Producer area (`/admin`)
- **Overview** — revenue, pending payments, artists, unread messages, recent sales, latest emails.
- **Beats** — upload audio + cover art, set price/BPM/key/genre/description, publish or hide,
  edit inline, delete. Lease price drives the tiers automatically (premium ×2, exclusive ×6).
- **Videos** — upload or embed, thumbnail, publish/hide, delete.
- **Orders** — filter by status, confirm a bank transfer (sends the emails + unlocks download),
  mark failed, grab the file.
- **Messages** — threaded inbox per artist; replies are emailed.
- **Mailbox** — every generated email by category, with a rendered preview.
- **Settings** — SMTP credentials, studio profile, payment methods and bank details.

---

## Configuration

Copy `.env.example` to `.env` and adjust. Everything is optional; the app runs with defaults.

```bash
cp .env.example .env
```

The most useful variables:

| Variable | Purpose |
| --- | --- |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Producer login, created on first run |
| `STUDIO_NAME`, `PRODUCER_NAME`, `STUDIO_TAGLINE`, `STUDIO_EMAIL` | Branding everywhere |
| `SESSION_SECRET` | Cookie signing secret — set in production |
| `PUBLIC_URL` | Base URL used inside email links |
| `PAYMENTS_MODE` | `demo` (auto-confirm) or `live` |
| `BANK_*` | Bank details shown at checkout |
| `SMTP_*`, `MAIL_FROM` | Real email delivery |
| `DB_FILE` | SQLite path (default `data/producer.db`) |

`.env` is loaded if present (`server.js` reads it via Node's built-in `--env-file` support when
started with `npm run dev`), but environment variables always win.

---

## Project layout

```
server.js              long-running entry point (listen, demo-payment recovery)
app.js                 the Express app itself (shared with api/index.js)
api/index.js           serverless (Vercel) entry point
Dockerfile             production image, data on a /data volume
render.yaml            Render blueprint (web service + disk)
lib/db.js              SQLite schema + seeding + password hashing
lib/paths.js           storage layout (local vs /tmp vs mounted volume)
lib/session-store.js   SQLite-backed express-session store
lib/orders.js          order lifecycle, licence pricing, all purchase emails
lib/payments.js        Mobile Money / bank config + demo auto-confirmation
lib/mailer.js          nodemailer + the offline mailbox fallback
lib/upload.js          multer storage / mime validation for covers, audio, video
routes/public.js       storefront, checkout, download tokens, order status API
routes/auth.js         register / login / logout
routes/dashboard.js    artist dashboard + messaging
routes/admin.js        producer area (beats, videos, orders, messages, mailbox, settings)
views/                 EJS templates (public, artist, admin, partials)
public/css/app.css     design system
public/js/app.js       equalizer, audio player, checkout, polling
scripts/               e2e test, demo audio generator, seed
```

Uploads land in `public/uploads/{covers,audio,video}`, or in `UPLOAD_DIR` when one is set (in the
container: `/data/uploads`). Swap that for S3/R2 or any object store before production — just
change `lib/upload.js` and the `cover_image` / `audio_file` values.

---

## Testing the whole flow

With the server running:

```bash
npm test
```

This registers an artist, sends a message, buys a licence with Mobile Money, waits for the demo
confirmation, checks the download link, logs in as the producer, verifies the order/inbox/mailbox
emails and uploads a beat — printing a pass/fail line for each step.

---

## Regenerating demo content

```bash
npm run demo-audio      # regenerate the four demo loops (synthesised 16-bit WAVs)
rm data/producer.db*    # wipe and re-seed on next start
```

## Deploying

The repo ships config for both a serverless demo and a real, persistent host.
`/healthz` returns JSON and is used by the container health check and by
Render's health probe.

### Option A — Vercel (`api/index.js` + `vercel.json`)

Vercel doesn't run a `server.js` for you: without a function in `api/` it answers
every path with its own `404 NOT_FOUND`. That is now wired up, so importing the
repo just works:

1. **New Project → import this repo.** Framework preset: *Other*. Build command:
   empty. Output directory: `public` (already set in `vercel.json`).
2. Node.js version **22.x** (needed by `node:sqlite`) — the `engines` field asks for it.
3. Optional env vars: `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
   `STUDIO_NAME`, `PAYMENTS_MODE`.

How it behaves there:

| Works | Limited |
| --- | --- |
| Storefront, beat pages, videos, search | The bundle is read-only, so the SQLite DB and uploads go to `/tmp` — **data resets on a cold start** |
| Register / log in / dashboard (sessions are stored in SQLite) | Request bodies are capped at ~4.5 MB, so admin audio/video uploads fail |
| Checkout, demo auto-confirmation, download links, admin area | Demo confirmations are settled lazily when the order is polled, because `setTimeout`s can be frozen |

Treat Vercel as a shareable preview. For a store that keeps orders, use Option B.

### Option B — Docker / Render / Fly / Railway (recommended)

`Dockerfile`, `docker-compose.yml` and `render.yaml` are included.

```bash
docker compose up --build        # → http://localhost:3000, data in the studio-data volume
```

* The container stores everything under `/data` (`STUDIO_STORAGE_DIR=/data`,
  `UPLOAD_DIR=/data/uploads`). Mount a volume there and redeploys keep the
  database, the beat catalogue and uploaded art/audio.
* **Render:** *New → Blueprint*, pick this repo — `render.yaml` creates the web
  service, a 1 GB disk at `/data` and a generated `SESSION_SECRET`.
* Any other host: run `npm ci --omit=dev && node server.js` with Node 22 and set
  `STUDIO_STORAGE_DIR`/`UPLOAD_DIR` to a persistent volume.

### Environment variables that matter in production

| Variable | Why |
| --- | --- |
| `SESSION_SECRET` | Random string; cookies are signed with it |
| `COOKIE_SECURE=true` | Force `Secure` cookies when TLS terminates at a proxy |
| `PUBLIC_URL` | Absolute links inside emails |
| `STUDIO_STORAGE_DIR` / `UPLOAD_DIR` | Point the database and uploads at the volume |
| `DB_FILE` | Override just the SQLite path |

## Going live checklist

1. `SESSION_SECRET` → long random string, `PAYMENTS_MODE=live`.
2. Wire a real PSP in `lib/payments.js` and point its webhook at `markPaid()`.
3. Add SMTP credentials so receipts actually send.
4. Set `PUBLIC_URL` to your domain (email links use it).
5. Serve over HTTPS behind nginx/Caddy; move uploads to object storage.
6. Replace the demo beats and admin password.
