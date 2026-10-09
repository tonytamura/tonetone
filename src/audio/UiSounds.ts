import { AudioStore, BEAT, SILENCE, initAudio, isAudioAsleep, isOptionsOpen, isStopped, onAudioRebuild, scaleNote } from './SynthEngine';

/**
 * The interface's own voice: the binaural click every button makes.
 *
 * This is the game's third binaural synth, alongside the drone and the boom, and
 * it lived in `ui/MenuScreen.ts` until 2026-09-19 — which meant `main.ts` and the
 * sound tester both reached up into the menu to make a button noise. It is a
 * voice, so it lives with the voices.
 *
 * The notes carry the meaning and are named here rather than repeated as bare
 * frequencies at fifteen call sites.
 */

/**
 * The scale step each click plays, counted from A2 (see `scaleNote`): three in a
 * row, rising cancel → select → confirm — B3, C4, E4. They were fixed at C4, D4
 * and E4, which put select outside the game's scale, Hirajoshi.
 *
 * - `confirm` — confirm, unpause, start.
 * - `cancel` — cancel, close, pause.
 * - `select` — choosing an item on the menu.
 */
const CLICK_STEPS = { cancel: 6, select: 7, confirm: 8 } as const;
export type ClickNote = keyof typeof CLICK_STEPS;

/** The frequency a click plays. */
export function clickHz(note: ClickNote): number {
  return scaleNote(CLICK_STEPS[note]);
}

const CLICK_SECONDS = 0.16;

/**
 * How long a hover lasts, and how loud it is at its peak.
 *
 * The hover is the only click nobody asked for: it fires because a pointer
 * crossed a button, not because anyone pressed one. It was a 0.10s blip at 0.06,
 * short and near enough in level to the 0.30 select that running a mouse down
 * the list sounded like choosing four things. It is now longer and much quieter
 * — a soft ring rather than a tap — so that it reads as the pointer being
 * somewhere rather than as something having happened.
 */
const HOVER_SECONDS = 0.34;
const HOVER_VOL = 0.035;

/** The rise every click shares, in seconds. */
const CLICK_ATTACK = 0.015;

/**
 * The hover's tail: it falls to this fraction of its peak `HOVER_KNEE` seconds
 * in, then fades from there over the rest of its length.
 *
 * Without the knee a 0.34s click is a triangle, which swells and reads as a pad.
 * The fast drop keeps the attack a click; the long quiet tail is what makes it
 * last. Every other click keeps the straight fall it always had.
 */
const HOVER_TAIL = 0.3;
const HOVER_KNEE = 0.05;

/**
 * How far ahead the click schedules itself, in seconds.
 *
 * The longest look-ahead of any voice. A click fires straight off a pointer
 * event, which is the moment the main thread is busiest — laying out whatever
 * the press just changed — so it needs the most headroom before the audio
 * thread's next render quantum.
 */
const CLICK_LOOKAHEAD = 0.025;

/**
 * How long the click refuses to fire again.
 *
 * Clicks are short and loud, and a run of them inside one lock window reads as
 * a rattle rather than as several presses.
 */
export const MENU_CLICK_LOCK_MS = 180;

/**
 * At most this many click voices may overlap.
 *
 * The click has no ducking of its own, and the Web Audio render thread is the
 * thing that starves first on a phone.
 */
export const MAX_MENU_VOICES = 6;

let activeMenuVoices = 0;
let lastClickTimestamp = 0;
let lastSelectTimestamp = 0;
let clickLockMs = MENU_CLICK_LOCK_MS;
// Clicks in flight on a context that was rebuilt never report that they ended.
onAudioRebuild(() => { activeMenuVoices = 0; });

/** When a `'select'` click last played. The menu reads it to keep its hover
 *  blips from crowding a selection that has just been made. */
export function lastSelectAt(): number {
  return lastSelectTimestamp;
}

/**
 * Override the click lock, in milliseconds.
 *
 * This exists for tests, which need to fire clicks back to back to reach the
 * voice cap. It replaces a `process.env.NODE_ENV === 'test'` branch that used to
 * sit inside the voice itself — production code should not behave differently
 * because of an environment variable, and a test should say what it is changing.
 */
export function setClickLockMs(ms: number) {
  clickLockMs = ms;
}

/** Drop the voice count and the locks, so one test cannot leak into the next. */
export function resetUiSoundsForTesting() {
  activeMenuVoices = 0;
  lastClickTimestamp = 0;
  lastSelectTimestamp = 0;
  clickLockMs = MENU_CLICK_LOCK_MS;
}

/** Start the audio graph, resuming a context the browser stopped. */
export function initMenuAudio() {
  initAudio();
}

function getAudioCtx(): AudioContext | null {
  initMenuAudio();
  return AudioStore.actx;
}

/** The click a UI control makes: `confirm` affirms, `cancel` dismisses. */
export function uiClick(kind: 'confirm' | 'cancel') {
  initMenuAudio();
  playBinauralClick(clickHz(kind), CLICK_SECONDS, 0, 'toggle');
}

/**
 * The amplitude shape all three of a click's oscillators share: silent until the
 * scheduled start, a fast rise to `peak`, then a fall to nothing by `dur`.
 *
 * `tail` bends that fall — 0 for a straight line, or a fraction of the peak to
 * drop to at the knee and fade from. The three voices differ only in `peak`, so
 * this was the same five lines written three times.
 */
function shapeClick(
  gain: GainNode,
  peak: number,
  now: number,
  pTime: number,
  dur: number,
  tail: number
) {
  gain.gain.value = SILENCE;
  gain.gain.setValueAtTime(SILENCE, now);
  gain.gain.setValueAtTime(SILENCE, pTime);
  gain.gain.linearRampToValueAtTime(peak, pTime + CLICK_ATTACK);
  if (tail > 0) gain.gain.linearRampToValueAtTime(peak * tail, pTime + CLICK_ATTACK + HOVER_KNEE);
  gain.gain.linearRampToValueAtTime(0, pTime + dur);
}

/**
 * The soft ring a button makes when a mouse moves onto it.
 *
 * Only a mouse plays this. A finger sliding across the menu highlights buttons
 * silently, because it has not chosen anything until it lifts — see
 * `ui/menu/MenuScreen.ts`.
 */
export function playHoverClick(freq: number, xNorm: number) {
  playBinauralClick(freq, HOVER_SECONDS, xNorm, 'hover');
}

/**
 * Plays a single spatial 3D binaural menu click audio effect with left/right channel frequency separation,
 * sub-harmonic resonance, lowpass smoothing, and interaural Haas spatial delay.
 */
export function playBinauralClick(
  freq: number = clickHz('cancel'),
  duration: number = CLICK_SECONDS,
  xNorm: number = 0,
  clickType: 'select' | 'hover' | 'toggle' = 'select',
  volBoost: number = 1.0,
  ignoreOptionsGuard: boolean = false
) {
  if (!AudioStore.soundOn) return;
  if (!ignoreOptionsGuard && isOptionsOpen()) return;
  // An ambient click (a hover, an idle menu pop) is not played on a stopped or
  // sleeping context: its clock stands still, so the click only queued up,
  // holding a voice slot until it ran. Six idle pops before the first tap
  // filled the cap, the tap's own click was refused, and the six went off
  // together the moment the context started. A tap's click is still played:
  // the tap is what is resuming the context.
  const ctxNow = AudioStore.actx;
  if (clickType === 'hover' && ctxNow && (isStopped(ctxNow) || isAudioAsleep())) return;
  const nowMs = performance.now();
  if (nowMs - lastClickTimestamp < clickLockMs) return;
  if (activeMenuVoices >= MAX_MENU_VOICES) return;
  lastClickTimestamp = nowMs;
  if (clickType === 'select') {
    lastSelectTimestamp = nowMs;
  }

  let counted = false;
  try {
    const actx = getAudioCtx();
    if (!actx) return;

    const now = actx.currentTime;
    const dest = AudioStore.master || actx.destination;

    let targetFreq = freq;
    if (clickType === 'select') {
      targetFreq = Math.min(freq, clickHz('select'));
    } else if (clickType === 'hover') {
      targetFreq = Math.min(freq, clickHz('cancel'));
    }

    const baseVol = (clickType === 'hover' ? HOVER_VOL : clickType === 'toggle' ? 0.22 : 0.30) * volBoost;
    const tail = clickType === 'hover' ? HOVER_TAIL : 0;

    const leftPanVal = Math.max(-1, Math.min(1, -0.85 + xNorm * 0.25));
    const rightPanVal = Math.max(-1, Math.min(1, 0.85 + xNorm * 0.25));

    const nodesToClean: (AudioNode | OscillatorNode)[] = [];

    // Create lowpass filter node to eliminate any high-frequency harshness
    const lpFilter = actx.createBiquadFilter();
    nodesToClean.push(lpFilter);
    lpFilter.type = 'lowpass';
    const lpFreq = clickType === 'hover' ? 650 : 800;
    lpFilter.frequency.value = lpFreq;
    lpFilter.frequency.setValueAtTime(lpFreq, now);
    lpFilter.Q.setValueAtTime(0.5, now);
    lpFilter.connect(dest);

    const pTime = now + CLICK_LOOKAHEAD;
    const dur = Math.max(0.08, duration);
    const stopTime = pTime + dur + 0.04;

    // Sub-harmonic sine wave node (adds warm bass body)
    const subOsc = actx.createOscillator();
    const subGain = actx.createGain();
    nodesToClean.push(subOsc, subGain);
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(targetFreq * 0.5, pTime);
    shapeClick(subGain, baseVol * 0.35, now, pTime, dur, tail);
    subOsc.connect(subGain);
    subGain.connect(lpFilter);
    subOsc.start(pTime);
    subOsc.stop(stopTime);

    // Left Channel Oscillator (f - 2.5 Hz)
    const leftOsc = actx.createOscillator();
    const leftGain = actx.createGain();
    nodesToClean.push(leftOsc, leftGain);
    const leftFreq = targetFreq - BEAT / 2;

    leftOsc.type = 'sine';
    leftOsc.frequency.setValueAtTime(leftFreq, pTime);

    shapeClick(leftGain, baseVol, now, pTime, dur, tail);

    if (actx.createStereoPanner) {
      const panL = actx.createStereoPanner();
      nodesToClean.push(panL);
      panL.pan.setValueAtTime(leftPanVal, pTime);
      leftOsc.connect(leftGain);
      leftGain.connect(panL);
      panL.connect(lpFilter);
    } else {
      leftOsc.connect(leftGain);
      leftGain.connect(lpFilter);
    }

    leftOsc.start(pTime);
    leftOsc.stop(stopTime);

    // Right Channel Oscillator (f + 2.5 Hz)
    const rightOsc = actx.createOscillator();
    const rightGain = actx.createGain();
    nodesToClean.push(rightOsc, rightGain);
    const rightFreq = targetFreq + BEAT / 2;

    rightOsc.type = 'sine';
    rightOsc.frequency.setValueAtTime(rightFreq, pTime);

    shapeClick(rightGain, baseVol * 0.95, now, pTime, dur, tail);

    if (actx.createStereoPanner) {
      const panR = actx.createStereoPanner();
      nodesToClean.push(panR);
      panR.pan.setValueAtTime(rightPanVal, pTime);
      rightOsc.connect(rightGain);
      rightGain.connect(panR);
      panR.connect(lpFilter);
    } else {
      rightOsc.connect(rightGain);
      rightGain.connect(lpFilter);
    }

    activeMenuVoices++;
    counted = true;
    rightOsc.onended = () => {
      activeMenuVoices = Math.max(0, activeMenuVoices - 1);
      for (const n of nodesToClean) {
        try { n.disconnect(); } catch (e) {}
      }
      nodesToClean.length = 0;
    };

    rightOsc.start(pTime);
    rightOsc.stop(stopTime);
  } catch (e) {
    // Only a voice that was counted is uncounted: a throw before the count went
    // up used to take a slot from some other voice still playing.
    if (counted) activeMenuVoices = Math.max(0, activeMenuVoices - 1);
  }
}
