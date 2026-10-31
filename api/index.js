'use strict';
/**
 * Vercel entry point.
 *
 * Vercel serves the repo's public/ folder from its CDN and sends every other
 * path here (see vercel.json). The Express app is itself a (req, res) handler,
 * so it can be exported directly — no need for @vercel/node's helper wrapper.
 *
 * Notes for this platform:
 *  - the bundle is read-only, so the SQLite database and new uploads are kept
 *    in /tmp (see lib/paths.js). Data survives while a function instance is
 *    warm and is recreated from seed on a cold start. Use a host with a disk
 *    (Docker/Render/Fly) for real, durable data.
 *  - request bodies are capped at ~4.5 MB, so admin uploads of large audio or
 *    video files have to happen on a persistent host.
 */
module.exports = require('../app');
