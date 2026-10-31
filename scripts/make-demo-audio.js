'use strict';
/**
 * Generates short demo loops (16-bit mono WAV) so the seeded beats are playable
 * out of the box. Replace them with real masters in the producer area.
 *
 *   node scripts/make-demo-audio.js
 */
const fs = require('fs');
const path = require('path');

const SR = 22050;

const NOTES = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
function freq(note, octave) {
  const midi = 12 * (octave + 1) + NOTES[note];
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const TRACKS = [
  {
    file: 'seed-midnight-accra.wav',
    bpm: 102,
    root: 'F#', octave: 2,
    chords: [['F#', 'A', 'C#', 'E'], ['D', 'F#', 'A', 'C#'], ['B', 'D', 'F#', 'A'], ['C#', 'F', 'G#', 'B']],
    style: 'afro',
  },
  {
    file: 'seed-neon-highway.wav',
    bpm: 140,
    root: 'C', octave: 1,
    chords: [['C', 'D#', 'G', 'A#'], ['G#', 'C', 'D#', 'G'], ['A#', 'D', 'F', 'A'], ['G', 'A#', 'D', 'F']],
    style: 'trap',
  },
  {
    file: 'seed-violet-skies.wav',
    bpm: 88,
    root: 'A', octave: 2,
    chords: [['A', 'C#', 'E', 'G#'], ['F#', 'A', 'C#', 'E'], ['D', 'F#', 'A', 'C#'], ['E', 'G#', 'B', 'D']],
    style: 'rnb',
  },
  {
    file: 'seed-cyan-machine.wav',
    bpm: 144,
    root: 'G', octave: 1,
    chords: [['G', 'A#', 'D', 'F'], ['D#', 'G', 'A#', 'D'], ['F', 'A', 'C', 'D#'], ['C', 'D#', 'G', 'A#']],
    style: 'drill',
  },
];

const NUM = (len) => new Float32Array(len);

function env(i, len, a = 0.005, d = 0.9) {
  const t = i / SR;
  const atk = t < a ? t / a : 1;
  return atk * Math.exp(-t / d);
}

function kick(i, t) {
  const f = 130 * Math.exp(-t * 34) + 44;
  return Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 14) * 1.05;
}
function snare(i, t, t0) {
  const local = t - t0;
  const noise = (Math.random() * 2 - 1) * Math.exp(-local * 26);
  const body = Math.sin(2 * Math.PI * 190 * local) * Math.exp(-local * 22) * 0.5;
  return (noise * 0.55 + body) * 0.7;
}
function hat(i, t, t0, amp = 0.2) {
  const local = t - t0;
  return (Math.random() * 2 - 1) * Math.exp(-local * 90) * amp;
}

function synthTrack(cfg) {
  const beat = 60 / cfg.bpm;
  const bars = 4;
  const len = Math.round(beat * 4 * bars * SR);
  const out = NUM(len + SR);
  const barLen = beat * 4;

  // ---- chords / pads
  for (let bar = 0; bar < bars; bar++) {
    const chord = cfg.chords[bar % cfg.chords.length];
    const start = Math.round(bar * barLen * SR);
    chord.forEach((n, idx) => {
      const f = freq(n, cfg.octave + 3);
      for (let i = 0; i < Math.round(barLen * SR); i++) {
        const t = i / SR;
        const v =
          (Math.sin(2 * Math.PI * f * t) * 0.6 +
            Math.sin(2 * Math.PI * f * 2 * t) * 0.18 +
            Math.sin(2 * Math.PI * f * 3.01 * t) * 0.07) *
          Math.exp(-t * (cfg.style === 'rnb' ? 0.7 : 1.4));
        out[start + i] += v * 0.12 * (1 - idx * 0.06);
      }
    });
  }

  // ---- bass line (root, walking)
  for (let bar = 0; bar < bars; bar++) {
    const chord = cfg.chords[bar % cfg.chords.length];
    const root = chord[0];
    const hits = cfg.style === 'trap' || cfg.style === 'drill' ? [0, 2, 3, 3.5] : [0, 1.5, 2.5];
    for (const beatPos of hits) {
      const start = Math.round((bar * barLen + beatPos * beat) * SR);
      const dur = Math.round(beat * (cfg.style === 'trap' ? 1.1 : 0.9) * SR);
      const f = freq(root, cfg.octave);
      for (let i = 0; i < dur; i++) {
        const t = i / SR;
        const slide = cfg.style === 'trap' || cfg.style === 'drill'
          ? 1 + 0.06 * Math.exp(-t * 12)
          : 1;
        out[start + i] += Math.sin(2 * Math.PI * f * slide * t) * Math.exp(-t * 3.2) * 0.4;
      }
    }
  }

  // ---- melody pluck
  for (let bar = 0; bar < bars; bar++) {
    const chord = cfg.chords[bar % cfg.chords.length];
    const steps = cfg.style === 'rnb' ? [0, 1.5, 2.5, 3] : [0, 1, 2, 3, 3.5];
    steps.forEach((s, k) => {
      const start = Math.round((bar * barLen + s * beat) * SR);
      const note = chord[(k + 1) % chord.length];
      const f = freq(note, cfg.octave + 4);
      const dur = Math.round(beat * 0.8 * SR);
      for (let i = 0; i < dur; i++) {
        const t = i / SR;
        out[start + i] +=
          (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2 * t)) *
          Math.exp(-t * 6) * 0.16;
      }
    });
  }

  // ---- drums
  const kickPattern = cfg.style === 'rnb' ? [0, 2.5] : cfg.style === 'afro' ? [0, 1.75, 2, 3.25] : [0, 2, 2.75];
  const snarePositions = cfg.style === 'rnb' ? [1, 3] : cfg.style === 'drill' ? [1.5, 3] : [1, 3];
  for (let bar = 0; bar < bars; bar++) {
    for (const kp of kickPattern) {
      const start = Math.round((bar * barLen + kp * beat) * SR);
      for (let i = 0; i < Math.round(0.5 * SR); i++) out[start + i] += kick(i, i / SR) * 0.85;
    }
    for (const sp of snarePositions) {
      const start = Math.round((bar * barLen + sp * beat) * SR);
      for (let i = 0; i < Math.round(0.35 * SR); i++) out[start + i] += snare(i, i / SR, 0) * 0.55;
    }
    const hatDiv = cfg.style === 'rnb' ? 1 : cfg.style === 'drill' ? 0.25 : 0.5;
    for (let h = 0; h < 4; h += hatDiv) {
      const start = Math.round((bar * barLen + h * beat) * SR);
      const amp = h % 1 === 0 ? 0.18 : 0.1;
      for (let i = 0; i < Math.round(0.12 * SR); i++) out[start + i] += hat(i, i / SR, 0, amp);
    }
  }

  // ---- simple fade in/out + soft clip
  const fade = Math.round(0.05 * SR);
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
    const j = len - 1 - i;
    if (j > 0) out[j] *= i / fade;
  }
  for (let i = 0; i < len; i++) {
    const v = out[i];
    out[i] = Math.tanh(v * 1.1) * 0.92;
  }
  return out.subarray(0, len);
}

function writeWav(file, samples) {
  const bytes = samples.length * 2;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);       // PCM
  buf.writeUInt16LE(1, 22);       // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(bytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
  return buf.length;
}

const outDir = path.join(__dirname, '..', 'public', 'uploads', 'audio');
fs.mkdirSync(outDir, { recursive: true });

for (const cfg of TRACKS) {
  const samples = synthTrack(cfg);
  const size = writeWav(path.join(outDir, cfg.file), samples);
  console.log(`  ♪ ${cfg.file}  ${cfg.bpm} BPM  ${(size / 1024 / 1024).toFixed(2)} MB`);
}
console.log('\nDemo loops written to public/uploads/audio/');
