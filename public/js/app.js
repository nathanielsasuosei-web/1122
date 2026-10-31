/* Bassline Studio — front-end behaviour */
(function () {
  'use strict';

  /* ------------------------------------------------------- mobile nav */
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');
  if (toggle && links) {
    toggle.addEventListener('click', () => links.classList.toggle('open'));
  }

  /* ----------------------------------------------------- equalizer bars */
  const eqs = document.querySelectorAll('.equalizer');
  eqs.forEach((eq, idx) => {
    const bars = Number(eq.dataset.bars || 44);
    for (let i = 0; i < bars; i++) {
      const bar = document.createElement('i');
      // Deterministic-ish pseudo random so the wall looks organic but stable.
      const seed = Math.sin((i + 1) * (idx + 2) * 12.9898) * 43758.5453;
      const r = seed - Math.floor(seed);
      bar.style.animationDuration = (0.72 + r * 0.9).toFixed(2) + 's';
      bar.style.animationDelay = (-r * 1.4).toFixed(2) + 's';
      bar.style.height = Math.round(18 + r * 74) + '%';
      bar.style.opacity = (0.55 + r * 0.45).toFixed(2);
      eq.appendChild(bar);
    }
  });

  const wave = document.querySelector('.now .wave');
  if (wave) {
    for (let i = 0; i < 7; i++) {
      const b = document.createElement('i');
      b.style.height = 20 + Math.random() * 60 + '%';
      b.style.animationDelay = (-Math.random()).toFixed(2) + 's';
      wave.appendChild(b);
    }
  }

  /* ------------------------------------------------------ audio player */
  const bar = document.getElementById('nowBar');
  const audio = document.getElementById('player');
  const fill = document.getElementById('nowFill');
  const timeEl = document.getElementById('nowTime');
  const titleEl = document.getElementById('nowTitle');
  const metaEl = document.getElementById('nowMeta');
  const artEl = document.getElementById('nowArt');
  const toggleBtn = document.getElementById('nowToggle');
  const progress = document.getElementById('nowProgress');
  const buyBtn = document.getElementById('nowBuy');

  const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  let current = null;

  const fmt = (s) => {
    if (!Number.isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  };

  function setPlaying(playing) {
    if (toggleBtn) toggleBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    document.querySelectorAll('[data-play]').forEach((btn) => {
      const isCurrent = current && String(btn.dataset.play) === String(current.id);
      btn.innerHTML = isCurrent && playing ? ICON_PAUSE : ICON_PLAY;
      btn.setAttribute('aria-label', isCurrent && playing ? 'Pause' : 'Play preview');
    });
  }

  function load(track) {
    current = track;
    audio.src = track.src;
    if (titleEl) titleEl.textContent = track.title;
    if (metaEl) metaEl.textContent = track.meta || '';
    if (artEl) {
      if (track.cover) { artEl.src = track.cover; artEl.style.display = 'block'; }
      else { artEl.removeAttribute('src'); artEl.style.background = 'linear-gradient(115deg,#ff3d8b,#8b5cf6,#22d3ee)'; }
    }
    if (buyBtn) buyBtn.href = track.href || '/beats';
    if (bar) bar.classList.add('show');
  }

  if (audio) {
    document.querySelectorAll('[data-play]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const track = {
          id: btn.dataset.play,
          src: btn.dataset.src,
          title: btn.dataset.title,
          meta: btn.dataset.meta,
          cover: btn.dataset.cover,
          href: btn.dataset.href,
        };
        if (!track.src) return;
        const isSame = current && String(current.id) === String(track.id);
        if (isSame) {
          if (audio.paused) audio.play().catch(() => {});
          else audio.pause();
        } else {
          load(track);
          audio.play().catch(() => {});
        }
      });
    });

    if (toggleBtn) {
      toggleBtn.innerHTML = ICON_PLAY;
      toggleBtn.addEventListener('click', () => {
        if (!current) return;
        if (audio.paused) audio.play().catch(() => {}); else audio.pause();
      });
    }

    audio.addEventListener('play', () => setPlaying(true));
    audio.addEventListener('pause', () => setPlaying(false));
    audio.addEventListener('ended', () => { setPlaying(false); if (fill) fill.style.width = '0%'; });
    audio.addEventListener('timeupdate', () => {
      const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
      if (fill) fill.style.width = pct + '%';
      if (timeEl) timeEl.textContent = fmt(audio.currentTime);
    });
    audio.addEventListener('loadedmetadata', () => {
      if (metaEl && current) {
        metaEl.textContent = (current.meta ? current.meta + ' · ' : '') + fmt(audio.duration);
      }
    });
    if (progress) {
      progress.addEventListener('click', (e) => {
        const rect = progress.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        if (audio.duration) audio.currentTime = audio.duration * ratio;
      });
    }
  }

  /* ------------------------------------------------------- video thumbs */
  document.querySelectorAll('[data-embed]').forEach((thumb) => {
    thumb.addEventListener('click', () => {
      const url = thumb.dataset.embed;
      const frame = document.createElement('iframe');
      frame.src = url + (url.includes('?') ? '&' : '?') + 'autoplay=1';
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture';
      frame.allowFullscreen = true;
      thumb.replaceWith(frame);
    });
  });

  /* ----------------------------------------------------- checkout logic */
  const momoFields = document.getElementById('momoFields');
  const bankFields = document.getElementById('bankFields');
  const methods = document.querySelectorAll('input[name="method"]');
  const licenseLabel = document.getElementById('licensePrices');
  function syncMethod() {
    const chosen = document.querySelector('input[name="method"]:checked');
    const isMomo = !chosen || chosen.value === 'momo';
    if (momoFields) momoFields.style.display = isMomo ? 'block' : 'none';
    if (bankFields) bankFields.style.display = isMomo ? 'none' : 'block';
  }
  methods.forEach((m) => m.addEventListener('change', syncMethod));
  syncMethod();

  document.querySelectorAll('input[name="license"]').forEach((input) => {
    input.addEventListener('change', () => {
      const price = input.dataset.price;
      document.querySelectorAll('[data-total]').forEach((el) => (el.textContent = price));
      if (licenseLabel) licenseLabel.textContent = input.dataset.label;
    });
  });

  /* ------------------------------------------------- pending order poll */
  const pending = document.querySelector('[data-pending-order]');
  if (pending) {
    const ref = pending.dataset.pendingOrder;
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      try {
        const res = await fetch('/api/orders/' + encodeURIComponent(ref), { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error('bad status');
        const data = await res.json();
        if (data.status !== 'pending') {
          clearInterval(timer);
          window.location.reload();
        }
      } catch (_) { /* keep polling quietly */ }
      if (tries > 40) clearInterval(timer);
    }, 2500);
  }

  /* ----------------------------------------------------- copy buttons */
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        const old = btn.textContent;
        btn.textContent = 'Copied ✓';
        setTimeout(() => (btn.textContent = old), 1600);
      } catch (_) { /* ignore */ }
    });
  });

  /* --------------------------------------------------- file input label */
  document.querySelectorAll('input[type="file"]').forEach((input) => {
    input.addEventListener('change', () => {
      const label = input.closest('.field')?.querySelector('.file-name');
      if (label) label.textContent = input.files[0] ? input.files[0].name : 'No file chosen';
    });
  });

  /* ------------------------------------------------ chat autoscroll */
  const chatLog = document.getElementById('chatLog');
  if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
})();
