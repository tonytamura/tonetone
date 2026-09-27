import { Haptics, ImpactStyle } from '@capacitor/haptics';

/**
 * The one scale the game plays in: Hirajoshi on A, as semitones above the root.
 *
 * The tuning panel used to offer four others — Minor and Major pentatonic,
 * Kumoi and Whole tone. On 2026-09-19 the difference could not be heard in play
 * and the picker was removed, so every voice is tuned to this one.
 */
export const SCALE_STEPS: readonly number[] = [0, 2, 3, 7, 8];

/** A2, the root the scale is built on, and the drone's pitch. */
export const SCALE_ROOT = 110;

/** The ten notes the colour voices index into: two octaves up from A2. */
export const SCALE_NOTES: readonly number[] = [0, 1].flatMap(oct =>
  SCALE_STEPS.map(st => SCALE_ROOT * Math.pow(2, (st + 12 * oct) / 12)));

/**
 * The note of the scale nearest `freq`, in whatever octave `freq` is in.
 *
 * This is how a voice with its own register stays in key: each pitch it aims at
 * moves onto the nearest scale note, which is never more than two semitones
 * away, so the voice keeps its character. Nearness is measured in semitones, not
 * Hz; a tie goes to the lower note.
 */
export function inKey(freq: number): number {
  const semis = 12 * Math.log2(freq / SCALE_ROOT);
  const octave = Math.floor(semis / 12);
  const within = semis - 12 * octave;
  let best = 0, gap = Infinity;
  for (const st of [...SCALE_STEPS, 12]) {
    if (Math.abs(within - st) < gap) { gap = Math.abs(within - st); best = st; }
  }
  return SCALE_ROOT * Math.pow(2, (12 * octave + best) / 12);
}

/**
 * The note `degree` steps of the scale above the root, A2; a negative degree
 * counts down. Used where several pitches must stay distinct and in order — the
 * boom tiers, the UI clicks — since snapping each one with `inKey` could land two
 * of them on the same note.
 */
export function scaleNote(degree: number): number {
  const n = SCALE_STEPS.length;
  const octave = Math.floor(degree / n);
  const st = SCALE_STEPS[degree - octave * n];
  return SCALE_ROOT * Math.pow(2, (12 * octave + st) / 12);
}

export interface AudioState {
  actx: AudioContext | null;
  master: GainNode | null;
  wetBus: GainNode | null;
  droneGain: GainNode | null;
  noiseBuf: AudioBuffer | null;
  droneOsc: OscillatorNode[] | null;
  soundOn: boolean;
  activeVoices: number;
  cursor: number;
  load: number;
  loadAt: number;
  thudAt: number;
  swooshAt: number;
  thuds: number;
  volume: number;
  lockVol: number;
  breakVol: number;
  boomVol: number;
  clickVol: number;
  drone: number;
  /** 1 = fire native haptics on sound events, 0 = silent. */
  haptics: number;
  /**
   * Low cut on the boom bus, in Hz.
   *
   * A phone speaker cannot move enough air for the bottom of a boom's dive, and
   * driving it there is heard as crackle — from Level 10-15 up on the ordinary
   * boom, and from 5-10 on the lifted white-on-black one, on the speaker but
   * never on headphones. This takes that energy out before it reaches any
   * speaker. It is a knob so the level can be found on the phone itself.
   */
  boomCut: number;
  /**
   * Pitch multiplier on the bright half of the black magnet lock.
   *
   * The lock is built from two halves that are filtered apart: a square-wave
   * electric arc with its highpass, resonant lowpass and noise sizzle, and a
   * sine suction sub underneath. This scales the first and leaves the second
   * alone, so turning it down does not just darken the arc — it shifts the
   * balance of the whole voice onto the sub.
   *
   * 1 is where the sound shipped, with the arc starting at 2.4 kHz and the
   * lowpass resonance at 5.2 kHz, doubled again for a black-on-black pair. That
   * put the loudest part of it in the 2-5 kHz band the ear is most sensitive to,
   * and it read as shrill. It is a knob rather than a constant for the same
   * reason `boomCut` is: which value stops being irritating depends on the
   * speaker, and the answer has to be found by ear on the device.
   */
  lockTone: number;
  /**
   * Requested output buffer size, in seconds; 0 leaves the choice to the browser.
   *
   * An AudioContext built with no options asks for `latencyHint: 'interactive'`,
   * the smallest buffer the device will give. On a phone WebView that buffer is
   * short enough that any frame overrunning its budget costs the audio thread a
   * deadline, which is heard as a crack — or, when several land together, as
   * crackle. Every voice here is already scheduled 10-30ms ahead, so buying
   * headroom with a little latency costs this game almost nothing.
   */
  latency: number;
}

export const AudioStore: AudioState = {
  actx: null,
  master: null,
  wetBus: null,
  droneGain: null,
  noiseBuf: null,
  droneOsc: null,
  soundOn: true,
  activeVoices: 0,
  cursor: -9,
  load: 0,
  loadAt: 0,
  thudAt: -9,
  swooshAt: -9,
  thuds: 0,
  volume: 0.9,
  lockVol: 1,
  breakVol: 1.7,
  boomVol: 1,
  clickVol: 0.5,
  drone: 0.25,
  haptics: 1,
  boomCut: 300,
  lockTone: 0.3,
  latency: 0.05,
};

/**
 * The gain an envelope rests at when it means silence.
 *
 * Not zero: `exponentialRampToValueAtTime` is undefined at zero and throws, and
 * a ramp that starts from exactly zero never leaves it. Every envelope in the
 * game therefore parks here instead — 88 times before this was one declaration,
 * and a floor that drifted between voices is a click in the ones that got it
 * wrong.
 */
export const SILENCE = 0.0001;

/**
 * The ambient drone's level at full `drone` knob.
 *
 * The drone runs continuously under everything, so this is deliberately far
 * below any voice. It is applied in two places — `applyDrone` and `startDrone` —
 * which must agree or the drone jumps in level the first time the knob moves.
 */
export const DRONE_LEVEL = 0.026;

export const MAX_VOICES = 22;
export const MAX_THUDS = 10;
export const BEAT = 5; // Hz binaural beat

export function loadAt_(now: number): number {
  return AudioStore.load * Math.pow(0.35, Math.max(0, now - AudioStore.loadAt));
}

/**
 * Minimum gap between haptic impacts, in milliseconds.
 *
 * On a phone the haptic actuator is audible through the chassis: a single
 * impact is a faint click and a rapid train of them is a buzz, both of which
 * arrive alongside the sound that triggered them and read as part of it. The
 * motor also cannot render impacts meaningfully faster than this, so anything
 * closer together is spent buzzing rather than being felt.
 */
const MIN_HAPTIC_GAP_MS = 50;
let lastHapticAt = -Infinity;

export function triggerHaptic(style: 'light' | 'medium' | 'heavy') {
  if (!AudioStore.haptics) return;
  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (nowMs - lastHapticAt < MIN_HAPTIC_GAP_MS) return;
  lastHapticAt = nowMs;
  try {
    const impactStyle =
      style === 'heavy' ? ImpactStyle.Heavy : style === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light;
    Haptics.impact({ style: impactStyle }).catch(() => {});
  } catch (e) {}
}

export function makeReverbIR(actx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = actx.sampleRate, len = Math.floor(rate * seconds);
  const buf = actx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const fade = i > len * 0.9 ? (len - i) / (len * 0.1) : 1.0;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * fade;
    }
  }
  return buf;
}

// --- Active node tracking for clean teardown ---
const _activeNodes = new Set<AudioNode & { stop?: () => void }>();

export function registerActiveNode(node: AudioNode & { stop?: () => void }) {
  _activeNodes.add(node);
}

export function unregisterActiveNode(node: AudioNode & { stop?: () => void }) {
  _activeNodes.delete(node);
}

let _dcBlockNode: BiquadFilterNode | null = null;
let _isResultsDucked = false;
let _isOptionsDucked = false;
let _isOptionsOpen = false;

export function isOptionsOpen(): boolean {
  if (_isOptionsOpen) return true;
  if (typeof document !== 'undefined') {
    const el = document.getElementById('panel');
    if (el && !el.hasAttribute('hidden')) return true;
  }
  return false;
}

export function setOptionsOpenState(open: boolean) {
  _isOptionsOpen = open;
  applyDrone();
}

/** Smoothly ramp drone gain to 0 (duck=true, options open, or soundOn=false) or restore it. */
export function applyDrone() {
  const { actx, droneGain, drone, soundOn } = AudioStore;
  if (!actx || !droneGain) return;
  const optionsActive = isOptionsOpen();
  const targetGain = _isResultsDucked || _isOptionsDucked || optionsActive || !soundOn ? 0 : DRONE_LEVEL * Math.max(0, drone);
  if (optionsActive || _isOptionsDucked) {
    droneGain.gain.setValueAtTime(0, actx.currentTime);
  } else {
    droneGain.gain.setTargetAtTime(targetGain, actx.currentTime, 0.4);
  }
}

export function fadeDroneForResults(duck: boolean) {
  _isResultsDucked = duck;
  applyDrone();
}

export function fadeDroneForOptions(duck: boolean) {
  _isOptionsDucked = duck;
  applyDrone();
}

// --- Lifecycle ---

/**
 * Whether the browser has stopped the context and a `resume()` could restart it.
 *
 * `'interrupted'` is not in every lib's `AudioContextState` yet, hence the string
 * compare. WebKit uses it when a call or another app takes the audio, and a check
 * for `'suspended'` alone leaves such a context silent for good.
 */
function isStopped(actx: AudioContext): boolean {
  const state: string = actx.state;
  return state === 'suspended' || state === 'interrupted';
}

/**
 * Start the audio graph, or restart a context the browser stopped.
 *
 * This is the one place anything resumes the context. Once the resume lands, the
 * output level is set again, which is the half of the sound toggle's recovery
 * that a bare `resume()` leaves out.
 */
export function initAudio() {
  const existing = AudioStore.actx;
  if (existing) {
    if (isStopped(existing)) {
      Promise.resolve(existing.resume()).then(applyGain, () => {});
    }
    return;
  }
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return;
  const actx = AudioStore.latency > 0 ? new AC({ latencyHint: AudioStore.latency }) : new AC();
  AudioStore.actx = actx;

  const master = actx.createGain();
  master.gain.value = AudioStore.soundOn ? AudioStore.volume : 0;

  const comp = actx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.knee.value = 24; comp.ratio.value = 2.0;
  comp.attack.value = 0.05; comp.release.value = 0.4;

  const dcBlock = actx.createBiquadFilter();
  dcBlock.type = 'highpass';
  dcBlock.frequency.value = 22;
  dcBlock.Q.value = 0.7;

  master.connect(comp);
  comp.connect(dcBlock);
  dcBlock.connect(actx.destination);
  AudioStore.master = master;
  _dcBlockNode = dcBlock;

  const nlen = Math.floor(actx.sampleRate * 2.0);
  AudioStore.noiseBuf = actx.createBuffer(1, nlen, actx.sampleRate);
  const nd = AudioStore.noiseBuf.getChannelData(0);
  const fadeLen = Math.floor(actx.sampleRate * 0.01);
  let lastSample = 0;
  for (let i = 0; i < nlen; i++) {
    const raw = Math.random() * 2 - 1;
    // 1-pole lowpass filter (pink/brown noise characteristic for crackle-free swooshes)
    lastSample = 0.65 * lastSample + 0.35 * raw;
    let s = lastSample;
    if (i < fadeLen) s *= (i / fadeLen);
    else if (i > nlen - fadeLen) s *= ((nlen - i) / fadeLen);
    nd[i] = s;
  }

  const conv = actx.createConvolver();
  conv.buffer = makeReverbIR(actx, 1.3, 3.0);
  const wetBus = actx.createGain();
  wetBus.gain.value = 0.35;
  wetBus.connect(conv);
  conv.connect(master);
  AudioStore.wetBus = wetBus;

  startDrone();
}

/**
 * Change the output buffer size.
 *
 * The hint is fixed for an AudioContext's lifetime, so this tears the context
 * down and builds a new one; voices in flight are lost, which is acceptable for
 * a deliberate settings change. It is a no-op until audio has actually started,
 * which keeps it safe for the headless harness, where there is no AudioContext
 * and no `window` for `initAudio` to read.
 */
export function setLatencyHint(seconds: number) {
  AudioStore.latency = seconds;
  const old = AudioStore.actx;
  if (!old) return;
  AudioStore.actx = null;
  AudioStore.master = null;
  AudioStore.wetBus = null;
  AudioStore.droneGain = null;
  AudioStore.droneOsc = null;
  AudioStore.noiseBuf = null;
  _dcBlockNode = null;
  AudioStore.activeVoices = 0;
  AudioStore.thuds = 0;
  try { old.close(); } catch (e) {}
  initAudio();
}

export function startDrone() {
  if (!AudioStore.actx || !AudioStore.master) return;
  const actx = AudioStore.actx;
  const soundOn = AudioStore.soundOn;
  const optionsActive = isOptionsOpen();
  const droneVal = _isResultsDucked || _isOptionsDucked || optionsActive || !soundOn ? 0 : Math.max(0, AudioStore.drone);
  const targetGain = DRONE_LEVEL * droneVal;

  const droneGain = actx.createGain();
  droneGain.gain.value = targetGain;
  const lp = actx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 420;
  droneGain.connect(lp);
  
  // Drone bypasses dynamics compressor to prevent 5Hz idle gain pumping & crackle
  const dest = _dcBlockNode || AudioStore.master;
  lp.connect(dest);
  AudioStore.droneGain = droneGain;

  AudioStore.droneOsc = [[110 - BEAT / 2, -1], [110 + BEAT / 2, 1]].map(([f, side]) => {
    const o = actx.createOscillator();
    o.type = 'sine'; o.frequency.value = f;
    const p = actx.createStereoPanner ? actx.createStereoPanner() : null;
    if (p) { p.pan.value = side; o.connect(p); p.connect(droneGain); }
    else o.connect(droneGain);
    o.start();
    return o;
  });
}

/**
 * Bring the sound back after the page has been out of view.
 *
 * A player who came back to a silent game could restore it by switching sound
 * off and on, and this does what that toggle does — resume the context, then set
 * the output level again — without their having to find it. A browser may refuse
 * the resume until the player touches the page, so `main.ts` calls this both when
 * the page is shown and again on the first gesture afterwards. It does nothing
 * until audio has started, so it cannot create a context outside a gesture.
 */
export function wakeAudio() {
  if (!AudioStore.actx) return;
  initAudio();
  applyGain();
}

export function applyGain() {
  if (AudioStore.actx && AudioStore.master) {
    AudioStore.master.gain.setTargetAtTime(
      AudioStore.soundOn ? AudioStore.volume : 0,
      AudioStore.actx.currentTime,
      0.08
    );
    applyDrone();
  }
}

/** Stop and disconnect all actively tracked audio nodes, reset voice counters. */
export function stopAllVoices() {
  for (const node of _activeNodes) {
    try { (node as any).stop?.(); } catch (_) {}
    try { node.disconnect(); } catch (_) {}
  }
  _activeNodes.clear();
  AudioStore.activeVoices = 0;
  AudioStore.thuds = 0;
  AudioStore.cursor = 0;
}
