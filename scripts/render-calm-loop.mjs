#!/usr/bin/env node
// Stage 18 — render the Calm session ambient loop deterministically.
//
// Produces client/src/assets/calm-loop.mp3, a polyphonic 16-second stereo
// box-breathing loop matching the spectral structure of the user's
// reference recording (calm-phasinginandout.m4a).
//
// Phase structure (4 s each):
//
//   0  -  4 s   Inhale       B4 + E4 + A3  (Em7-no5 voicing, top voice B4)
//   4  -  8 s   Hold (full)  A5 + A3       (octave-spread A drone)
//   8  - 12 s   Exhale       C#4 + A3 + E3 (A major root-position triad)
//   12 - 16 s   Hold (empty) A5 + A3       (octave-spread A drone)
//
// Architectural notes:
//   - A3 (220 Hz) is held continuously across the whole loop as a tonal
//     drone, matching the reference where A3 is present in every phase.
//   - The upper voice changes at each phase boundary, with a 250 ms
//     equal-power crossfade between voices for click-free transitions.
//   - The two holds share the same chord (A5 + A3 over the A3 drone),
//     reinforcing the "ground" feeling at the top and bottom of each
//     breath cycle, exactly as in the reference.
//   - Loop wrap (t=16 -> t=0): same crossfade treatment as any other
//     phase boundary. Because A3 is the drone in all four phases the
//     wrap is doubly seamless.
//
// Pure Node synthesis, no npm dependencies. Writes a temp WAV then
// encodes to MP3 via system ffmpeg. Idempotent, byte-stable.

import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const PHASE_S = 4;
const DURATION_S = 16;
const TOTAL_SAMPLES = SAMPLE_RATE * DURATION_S;

// Phase definitions. `topVoices` = notes specific to this phase.
// `droneFreqs` is shared across all phases.
const DRONE_FREQS = [220.0]; // A3 — always present
const PHASES = [
  {
    name: "inhale",
    topVoices: [
      { freq: 493.88, gain: 1.00 }, // B4 (loudest)
      { freq: 329.63, gain: 0.55 }, // E4
    ],
  },
  {
    name: "hold_full",
    topVoices: [
      { freq: 880.00, gain: 1.00 }, // A5 (top)
    ],
  },
  {
    name: "exhale",
    topVoices: [
      { freq: 277.18, gain: 1.00 }, // C#4
      { freq: 164.81, gain: 0.70 }, // E3
    ],
  },
  {
    name: "hold_empty",
    topVoices: [
      { freq: 880.00, gain: 1.00 }, // A5 again
    ],
  },
];

// Crossfade duration between phases.
const CROSSFADE_S = 0.25;
const CROSSFADE_SAMPLES = Math.floor(CROSSFADE_S * SAMPLE_RATE);

// Equal-power crossfade weight at position [0, 1].
function eqPowerGain(t01) {
  return Math.sin((t01 * Math.PI) / 2);
}

// Build an envelope (Float32Array, length TOTAL_SAMPLES) for the given phase index.
// Envelopes from adjacent phases are time-shifted equal-power crossfades, so
// at any moment the SUM of all phase envelopes = 1.
function buildPhaseEnvelope(phaseIdx) {
  const env = new Float32Array(TOTAL_SAMPLES);
  const phaseStartSample = phaseIdx * PHASE_S * SAMPLE_RATE;
  const phaseEndSample = (phaseIdx + 1) * PHASE_S * SAMPLE_RATE;
  const halfXf = Math.floor(CROSSFADE_SAMPLES / 2);

  // Fully-on region: [phaseStart + halfXf  ..  phaseEnd - halfXf]
  for (let i = phaseStartSample + halfXf; i < phaseEndSample - halfXf; i++) {
    env[((i % TOTAL_SAMPLES) + TOTAL_SAMPLES) % TOTAL_SAMPLES] = 1;
  }

  // Fade in: [phaseStart - halfXf .. phaseStart + halfXf]
  for (let k = 0; k < CROSSFADE_SAMPLES; k++) {
    const t01 = k / (CROSSFADE_SAMPLES - 1);
    const i = phaseStartSample - halfXf + k;
    const idx = ((i % TOTAL_SAMPLES) + TOTAL_SAMPLES) % TOTAL_SAMPLES;
    env[idx] = eqPowerGain(t01);
  }

  // Fade out: [phaseEnd - halfXf .. phaseEnd + halfXf]
  for (let k = 0; k < CROSSFADE_SAMPLES; k++) {
    const t01 = k / (CROSSFADE_SAMPLES - 1);
    const i = phaseEndSample - halfXf + k;
    const idx = ((i % TOTAL_SAMPLES) + TOTAL_SAMPLES) % TOTAL_SAMPLES;
    env[idx] = eqPowerGain(1 - t01);
  }

  return env;
}

function renderChannel(channelIndex) {
  const out = new Float32Array(TOTAL_SAMPLES);

  // Per-channel detune for stereo width.
  const detuneCents = channelIndex === 0 ? -1.4 : 1.4;
  const detuneMult = Math.pow(2, detuneCents / 1200);

  // 1. Continuous drone (A3) over the whole loop. No envelope.
  for (const f of DRONE_FREQS) {
    const freq = f * detuneMult;
    for (let i = 0; i < TOTAL_SAMPLES; i++) {
      const t = i / SAMPLE_RATE;
      out[i] += Math.sin(2 * Math.PI * freq * t) * 0.35;
    }
  }

  // 2. Each phase's top voices, gated by that phase's envelope.
  const envelopes = PHASES.map((_p, k) => buildPhaseEnvelope(k));
  for (let k = 0; k < PHASES.length; k++) {
    const env = envelopes[k];
    for (const voice of PHASES[k].topVoices) {
      const freq = voice.freq * detuneMult;
      for (let i = 0; i < TOTAL_SAMPLES; i++) {
        const t = i / SAMPLE_RATE;
        out[i] += Math.sin(2 * Math.PI * freq * t) * voice.gain * 0.28 * env[i];
      }
    }
  }

  // 3. Headroom + gentle soft-clip.
  for (let i = 0; i < TOTAL_SAMPLES; i++) {
    out[i] = Math.tanh(out[i] * 0.9) * 0.7;
  }

  return out;
}

function writeWavFile(filePath, left, right) {
  const numSamples = left.length;
  const byteRate = SAMPLE_RATE * CHANNELS * 2;
  const blockAlign = CHANNELS * 2;
  const dataSize = numSamples * CHANNELS * 2;
  const headerSize = 44;
  const buf = Buffer.alloc(headerSize + dataSize);
  let p = 0;
  buf.write("RIFF", p); p += 4;
  buf.writeUInt32LE(36 + dataSize, p); p += 4;
  buf.write("WAVE", p); p += 4;
  buf.write("fmt ", p); p += 4;
  buf.writeUInt32LE(16, p); p += 4;
  buf.writeUInt16LE(1, p); p += 2;
  buf.writeUInt16LE(CHANNELS, p); p += 2;
  buf.writeUInt32LE(SAMPLE_RATE, p); p += 4;
  buf.writeUInt32LE(byteRate, p); p += 4;
  buf.writeUInt16LE(blockAlign, p); p += 2;
  buf.writeUInt16LE(16, p); p += 2;
  buf.write("data", p); p += 4;
  buf.writeUInt32LE(dataSize, p); p += 4;
  for (let i = 0; i < numSamples; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    buf.writeInt16LE(Math.round(l * 32767), p); p += 2;
    buf.writeInt16LE(Math.round(r * 32767), p); p += 2;
  }
  writeFileSync(filePath, buf);
}

function main() {
  console.log(`Rendering polyphonic Calm box-breathing loop: ${DURATION_S}s stereo @ ${SAMPLE_RATE} Hz`);
  console.log(`Drone (continuous): ${DRONE_FREQS.map((f) => f + "Hz").join(", ")}`);
  for (const p of PHASES) {
    const voices = p.topVoices.map((v) => `${v.freq}Hz@${v.gain}`).join(", ");
    console.log(`  ${p.name}: ${voices}`);
  }

  const left = renderChannel(0);
  const right = renderChannel(1);

  const tmpWav = path.join(REPO_ROOT, "scripts", "_calm-loop.tmp.wav");
  const outMp3 = path.join(REPO_ROOT, "client", "src", "assets", "calm-loop.mp3");

  mkdirSync(path.dirname(outMp3), { recursive: true });
  writeWavFile(tmpWav, left, right);

  execFileSync(
    "ffmpeg",
    ["-y", "-i", tmpWav, "-codec:a", "libmp3lame", "-b:a", "96k", outMp3],
    { stdio: "inherit" },
  );

  try { execFileSync("rm", [tmpWav]); } catch { /* ignore */ }
  console.log(`Wrote: ${outMp3}`);
}

main();
