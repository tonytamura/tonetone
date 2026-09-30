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
export function isStopped(actx: AudioContext): boolean {
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
    // Asleep means the game put it to sleep itself, for the page being out of
    // view; only coming back wakes it, not a timer that fires meanwhile.
    if (isStopped(existing) && !_asleep) {
      Promise.resolve(existing.resume()).then(
        () => { audioLog('resumed'); applyGain(); },
        () => audioLog('resume refused'),
      );
    }
    return;
  }
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return;
  const actx = AudioStore.latency > 0 ? new AC({ latencyHint: AudioStore.latency }) : new AC();
  AudioStore.actx = actx;
  audioLog(`created (${actx.state})`);

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
  rebuildAudio('latency');
}

const rebuildListeners: (() => void)[] = [];

/**
 * Called after every rebuild, for the modules that keep their own count or
 * clock of the voices in flight (the menu clicks, the attract booms). Those
 * voices went with the old context and never report that they ended, so a count
 * left standing would hold the new context under its cap for good.
 */
export function onAudioRebuild(fn: () => void): void {
  rebuildListeners.push(fn);
}

/** How many times the context has been rebuilt, for the audio readout. */
let rebuilds = 0;
export function audioRebuilds(): number {
  return rebuilds;
}

/**
 * Throw the context away and build a new one.
 *
 * Every time the voices read — the note cursor, the load, the thud and swoosh
 * gaps — is on the old context's clock, and the new clock starts again at zero,
 * so all of it is reset with the counts; left alone, a swoosh would wait out
 * however many minutes the old clock had run. A no-op until audio has started,
 * which keeps it safe for the headless harness.
 */
export function rebuildAudio(reason: string) {
  const old = AudioStore.actx;
  if (!old) return;
  audioLog(`rebuild: ${reason}`);
  stopAllVoices();
  AudioStore.actx = null;
  AudioStore.master = null;
  AudioStore.wetBus = null;
  AudioStore.droneGain = null;
  AudioStore.droneOsc = null;
  AudioStore.noiseBuf = null;
  _dcBlockNode = null;
  AudioStore.cursor = -9;
  AudioStore.load = 0;
  AudioStore.loadAt = 0;
  AudioStore.thudAt = -9;
  AudioStore.swooshAt = -9;
  _asleep = false;
  _returnedAt = null;
  _stuckSince = null;
  rebuilds++;
  try { Promise.resolve(old.close()).catch(() => {}); } catch (e) {}
  initAudio();
  for (const fn of rebuildListeners) fn();
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

// --- Leaving the page and coming back ---
//
// Coming back to the game could leave the sound on but silent until the player
// switched it off and on (Chrome on Android, 2026-09-19). Resuming the context on
// return did not cure it, so the return path now does three things:
//
// 1. Leaving puts the audio to sleep: the context is suspended, and no voice
//    starts while it sleeps. Nothing plays to an empty room, the timers that keep
//    running out of view cannot queue a burst of stale booms for the return, and
//    every return is a suspend-then-resume, which is what recovers an Android
//    output that another app's audio took over.
// 2. Coming back resumes it, as before.
// 3. The first gesture after coming back checks the context really is playing —
//    running, with its clock moving — and if not, builds a new one there and then,
//    inside the gesture, where a browser always lets a context start.

let _asleep = false;
/** Where the page came back: the wall time and the audio clock at that moment. */
let _returnedAt: { wall: number; clock: number } | null = null;
/** Since when a gesture has found the context stopped, if it still is. */
let _stuckSince: number | null = null;

/** How long after coming back the context has to have got going. */
export const RETURN_GRACE_MS = 250;

const wallMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Whether the game has put the audio to sleep for the page being out of view. */
export function isAudioAsleep(): boolean {
  return _asleep;
}

const LOG_LINES = 8;
const log: string[] = [];
/** A short log of what the context went through, for the `?audiodebug` readout. */
export function audioLog(line?: string): readonly string[] {
  if (line) {
    // The same event again, such as a resume the menu asks for every second or
    // two before the first tap, counts up on its line instead of filling the log.
    const last = log[log.length - 1];
    const m = last && last.match(/^[\d.]+s (.*?)(?: ×(\d+))?$/);
    const s = (wallMs() / 1000).toFixed(1);
    if (m && m[1] === line) log[log.length - 1] = `${s}s ${line} ×${Number(m[2] ?? 1) + 1}`;
    else log.push(`${s}s ${line}`);
    if (log.length > LOG_LINES) log.shift();
  }
  return log;
}

/** The page went out of view. */
export function sleepAudio() {
  const actx = AudioStore.actx;
  if (!actx) return;
  _asleep = true;
  _returnedAt = null;
  audioLog(`hidden (${actx.state})`);
  if (actx.state === 'running') {
    try { Promise.resolve(actx.suspend()).catch(() => {}); } catch (e) {}
  }
}

/**
 * Bring the sound back: resume the context, then set the output level again —
 * what the sound toggle does. It does nothing until audio has started, so it
 * cannot create a context outside a gesture.
 */
export function wakeAudio() {
  if (!AudioStore.actx) return;
  _asleep = false;
  initAudio();
  applyGain();
}

/**
 * The page came back into view. Only a page that was put to sleep has come
 * back: the `pageshow` of the first load is not a return, and neither is the
 * second of the two events a return can raise.
 */
export function audioReturned() {
  const actx = AudioStore.actx;
  if (!actx || !_asleep) return;
  audioLog(`shown (${actx.state}, t ${actx.currentTime.toFixed(2)})`);
  wakeAudio();
  _returnedAt = { wall: wallMs(), clock: actx.currentTime };
  _stuckSince = _returnedAt.wall;
}

/**
 * Every gesture calls this. It checks the context is playing, and rebuilds it
 * inside the gesture if it is not.
 *
 * - **Stopped.** A gesture that finds the context stopped wakes it and starts a
 *   `RETURN_GRACE_MS` wait; a gesture after that wait finding it still stopped
 *   rebuilds it. A resume asked for inside a gesture can still hang — Chrome
 *   leaves the promise pending when it will not start the output — and that
 *   happens on the first taps of a page as well as after a return.
 * - **Running, after a return.** It must also be keeping time: a context that
 *   reports running while its clock stands still past the wait is rebuilt too.
 * - **Still asleep.** The return event never arrived, which a WebView can do,
 *   so the gesture counts as the return.
 */
export function checkAudioOnGesture() {
  const actx = AudioStore.actx;
  if (!actx) return;
  if (_asleep) audioReturned();
  const now = wallMs();
  if (isStopped(actx)) {
    if (_stuckSince === null) {
      audioLog(`tap: ${actx.state}`);
      _stuckSince = now;
    } else if (now - _stuckSince >= RETURN_GRACE_MS) {
      rebuildAudio(`still ${actx.state}`);
      return;
    }
    wakeAudio();
    return;
  }
  _stuckSince = null;
  if (!_returnedAt) return;
  if (actx.currentTime > _returnedAt.clock) {
    audioLog(`playing (t ${actx.currentTime.toFixed(2)})`);
    _returnedAt = null;
    return;
  }
  if (now - _returnedAt.wall >= RETURN_GRACE_MS) rebuildAudio('clock stood still');
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
