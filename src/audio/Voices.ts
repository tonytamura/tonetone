import { AudioStore, BEAT, SILENCE, isOptionsOpen, isAudioAsleep, isStopped, onAudioRebuild, loadAt_, MAX_THUDS, MAX_VOICES, triggerHaptic, inKey, scaleNote, SCALE_NOTES } from './SynthEngine';
import { boomTierOf, BOOM_TIER_COUNT as RULES_BOOM_TIER_COUNT } from '../game/Rules';

export const BREAK_VOICE = {
  mul: 1, dur: 0.42, jitter: 0.10, peak: 0.42, attack: 0.010, tick: 0.10,
  partials: [[1, 1], [2, 0.34]] as [number, number][], open: 2600, close: 700, dry: 0.62
};

/**
 * `mul` must be a whole number of octaves (1, 2, 4), or the voice plays the scale
 * from a different root than everything else. The bond was ×2.5 — an octave and
 * a flat major third — so locks and knocks played the scale from C# over a drone,
 * booms and breaks on A.
 */
export const BOND_VOICE = {
  mul: 2, dur: 0.32, jitter: 0.18, peak: 0.36, attack: 0.004, tick: 0.26,
  partials: [[1, 1], [2, 0.42]] as [number, number][], open: 3400, close: 1000, dry: 0.62
};

/**
 * The countdown tick's level, and the louder "Start!" / "0" blip's.
 *
 * Halved on 2026-09-19: the tick read as too loud in play. It is a bare sine
 * near the ear's most sensitive band and deliberately bypasses both the
 * per-event volume knobs and the load ducking, so it carries further than its
 * number suggests beside the game's 110-400 Hz voices.
 */
export const TICK_LEVEL = 0.022;
export const TICK_GO_LEVEL = 0.032;

/**
 * High-pitch countdown tick — a short, bright beep that rings above normal
 * game sounds.  `isGo` switches to a triumphant rising double-blip for the
 * "Start!" / "0" moment.
 */
export function playCountdownTick(opts: { isGo?: boolean; ignoreOptionsGuard?: boolean } = {}) {
  const { isGo = false, ignoreOptionsGuard = false } = opts;
  if (!voiceAllowed(ignoreOptionsGuard)) return;
  const actx = AudioStore.actx!;
  const now = actx.currentTime;
  const t = now + LOOKAHEAD.short;
  const dest = AudioStore.master!;

  // Sits at the top of the mix without towering over it: this is a bare sine at
  // 1180 Hz, near the ear's most sensitive band, and it bypasses both the
  // per-kind level knobs and the duck mixer, so it reads louder than its
  // amplitude suggests next to the game's 110-400 Hz voices.
  const vol = isGo ? TICK_GO_LEVEL : TICK_LEVEL;
  const freq = inKey(1180);              // bright, above the game palette, in key
  const dur = isGo ? 0.16 : 0.09;

  const parts: (AudioNode & { stop?: () => void })[] = [];

  // Main tone oscillator
  const osc = actx.createOscillator();
  const env = actx.createGain();
  parts.push(osc, env);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);

  env.gain.value = SILENCE;
  env.gain.setValueAtTime(SILENCE, now);
  env.gain.setValueAtTime(SILENCE, t);
  env.gain.linearRampToValueAtTime(vol, t + 0.006);
  env.gain.linearRampToValueAtTime(vol * 0.6, t + dur * 0.5);
  env.gain.linearRampToValueAtTime(SILENCE, t + dur);
  env.gain.linearRampToValueAtTime(0, t + dur + 0.02);

  osc.connect(env);
  env.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.04);

  // Soft harmonic overtone for sparkle
  const h = actx.createOscillator();
  const hg = actx.createGain();
  parts.push(h, hg);
  h.type = 'sine';
  h.frequency.setValueAtTime(freq * 2.0, t);
  hg.gain.value = SILENCE;
  hg.gain.setValueAtTime(SILENCE, now);
  hg.gain.setValueAtTime(SILENCE, t);
  hg.gain.linearRampToValueAtTime(vol * 0.22, t + 0.006);
  hg.gain.linearRampToValueAtTime(SILENCE, t + dur * 0.65);
  hg.gain.linearRampToValueAtTime(0, t + dur + 0.02);
  h.connect(hg);
  hg.connect(dest);
  h.start(t);
  h.stop(t + dur + 0.04);

  // Haptic feedback
  triggerHaptic(isGo ? 'heavy' : 'medium');

  disposeWhenEnded(osc, parts);
}


/**
 * How far ahead a voice schedules itself, in seconds.
 *
 * Nothing is ever started at `currentTime`: the audio thread renders in
 * 128-sample quanta, and a node started inside the quantum already in flight
 * begins part-way through it, which is heard as a click. These seven values were
 * written inline and differ from each other with no reason recorded, so they are
 * named rather than unified — unifying them is a listening decision, not a
 * refactoring one.
 */
const LOOKAHEAD = {
  /** The countdown tick and the magnet lock: short, bright, want to feel immediate. */
  short: 0.012,
  /** Swooshes and knocks, the most frequent voices. */
  brief: 0.010,
  /** The boom, which is scheduled once and rings for seconds. */
  boom: 0.015,
  /** Notes, which also queue behind `AudioStore.cursor`. */
  note: 0.03,
};

/** Every node a voice built, so one `onended` can take the whole graph down. */
type VoiceParts = (AudioNode & { stop?: () => void })[];

/**
 * May this voice play at all?
 *
 * Every voice opened with the same two lines: sound off or no audio graph means
 * silence, and the tuning panel being open means silence unless the caller is
 * the sound tester, which is inside the panel and must be heard.
 *
 * `needs` names the extra pieces a voice cannot work without — the noise buffer
 * for anything with a transient, and the per-kind volume knob where one gates
 * the voice entirely.
 */
function voiceAllowed(ignoreOptionsGuard: boolean, needs: { noise?: boolean; vol?: number } = {}): boolean {
  if (!AudioStore.soundOn || !AudioStore.actx || !AudioStore.master) return false;
  // Out of view: a timer that fires meanwhile would only queue the voice up
  // behind the sleeping context, to play as a burst on the way back.
  if (isAudioAsleep()) return false;
  // Nor while the browser holds the context stopped — before the first tap, the
  // menu's ambience would otherwise queue a pile of voices to go off at once.
  if (isStopped(AudioStore.actx)) return false;
  if (!ignoreOptionsGuard && isOptionsOpen()) return false;
  if (needs.noise && !AudioStore.noiseBuf) return false;
  if (needs.vol !== undefined && needs.vol <= 0) return false;
  return true;
}

/**
 * Disconnect every node the voice built, once the node driving its lifetime ends.
 *
 * A voice that leaves its nodes connected leaks them: the graph keeps them
 * alive, and on a phone a few hundred of those is the difference between clean
 * audio and crackle. `also` runs first, for the voices that keep a count.
 */
function disposeWhenEnded(driver: AudioScheduledSourceNode, parts: VoiceParts, also?: () => void) {
  driver.onended = () => {
    if (also) also();
    for (const n of parts) { try { n.disconnect(); } catch (e) {} }
    parts.length = 0;
  };
}

/**
 * Route `from` into `to` through a stereo panner.
 *
 * `createStereoPanner` is absent on old WebViews, and every one of these sites
 * wrote the same fallback out: without a panner the voice connects straight
 * through and loses only its position, not its sound.
 */
function panned(from: AudioNode, to: AudioNode, pan: number, t: number | undefined, parts: VoiceParts) {
  const actx = AudioStore.actx!;
  if (actx.createStereoPanner) {
    const p = actx.createStereoPanner();
    parts.push(p);
    // Some voices place the pan once and some schedule it; both are kept, because
    // `.value` and `setValueAtTime` are not the same call on an AudioParam.
    if (t === undefined) p.pan.value = pan;
    else p.pan.setValueAtTime(pan, t);
    from.connect(p);
    p.connect(to);
  } else {
    from.connect(to);
  }
}

/**
 * Put a panner in front of `dest` and return what later nodes should connect to.
 *
 * The other half of the same fallback, for the voices that build a side and then
 * hang several nodes off it. Returns `dest` unchanged where there is no panner.
 */
function panInto(dest: AudioNode, pan: number, parts: VoiceParts): AudioNode {
  const actx = AudioStore.actx!;
  if (!actx.createStereoPanner) return dest;
  const p = actx.createStereoPanner();
  parts.push(p);
  p.pan.value = pan;
  p.connect(dest);
  return p;
}

/** Everything but the size and the pan that a boom needs. */
export interface BoomOptions {
  /** True for the sound tester, which lives inside the options panel. */
  ignoreOptionsGuard?: boolean;
  /** A white ball destroying a black one: the lifted voice with the metal ring. */
  whiteBlack?: boolean;
}

/** Everything but the degree, the pan and the kind that a note needs. */
export interface NoteOptions {
  boost?: number;
  /** Only read on the boom path, which forwards to `playBoom`. */
  boomSize?: number;
  ignoreOptionsGuard?: boolean;
  whiteBlack?: boolean;
}

/** Everything but the pan that a magnet lock needs. */
export interface MagnetLockOptions {
  ignoreOptionsGuard?: boolean;
  /** Two black balls locking to each other — the rarest bond on the table. */
  isPair?: boolean;
  /** The size of the group the merge produced, which sets the lock's weight. */
  groupSize?: number;
}

/** Everything but the pan and the force that a launch swoosh needs. */
export interface SwooshOptions {
  ignoreOptionsGuard?: boolean;
  /** The white cue ball, which is a struck metal sheet rather than a thud. */
  isWhite?: boolean;
}

function rampFreq(param: any, targetVal: number, targetTime: number) {
  if (param.linearRampToValueAtTime) {
    param.linearRampToValueAtTime(targetVal, targetTime);
  } else if (param.exponentialRampToValueAtTime) {
    param.exponentialRampToValueAtTime(Math.max(1, targetVal), targetTime);
  }
}

/**
 * Which boom-size tier a boom falls in, 0 (smallest) to 4.
 *
 * The thresholds are the game's, not the synth's: they come from `BOOM_TIERS` in
 * `game/Rules`, the same table the word on the pop is read from, so the sound and
 * the word step up together by construction rather than by a comment.
 */
export function boomTier(boomSize: number): number {
  return boomTierOf(boomSize);
}

export const BOOM_TIER_COUNT = RULES_BOOM_TIER_COUNT;

/**
 * Build a five-tier volume ramp that peaks at `peakTier`.
 *
 * Every tier up to the peak is a step on one even climb from `floor` to 1.0, so
 * the peak sits at the top of the usable range and everything below it ramps up
 * to meet it. Above the peak the ramp steps back down by `falloff` a tier.
 *
 * The ramp is generated rather than typed out so that moving a peak is one
 * number, and so the tiers below it are always redistributed across the whole
 * span instead of keeping whatever values they happened to have.
 */
export function boomVolumeRamp(peakTier: number, floor: number, falloff: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < BOOM_TIER_COUNT; i++) {
    const v = i <= peakTier
      ? (peakTier === 0 ? 1 : floor + (1 - floor) * (i / peakTier))
      : 1 - falloff * (i - peakTier);
    out.push(Math.max(0, Math.round(v * 100) / 100));
  }
  return out;
}

/**
 * The scale step each tier's dive lands on, counted from A2 (see `scaleNote`):
 * rising a step or two a tier, near the 88 / 116 / 149 / 187 / 231 Hz the dive
 * landed on when it was fixed. Explicit steps rather than `inKey`, so no two
 * tiers can land on the same note: F2 A2 C3 F3 A3.
 */
const BOOM_STEPS = [-1, 0, 2, 4, 5];

/** How far above its landing note a boom's dive starts. */
const DIVE_FROM = 3.4 / 1.1;
const BOOM_DUR = [0.60, 1.00, 1.10, 1.25, 1.40];

/**
 * Level every tier hits the compressor at, before the tier ramp is applied.
 *
 * Held constant on purpose: it is what makes the ramp mean anything. See the
 * note in `playBoom` — a ramp applied upstream of a 4.5:1 compressor
 * arrives at the output as a fraction of itself.
 */
const BOOM_DRIVE = 0.65;

/**
 * Post-compressor output, multiplied by the tier ramp and the user's boom knob.
 *
 * Lower than the 0.63 this used to sit at, because with the ramp now actually
 * reaching the output every tier is genuinely at its ramp value rather than
 * compressed up towards the loudest one.
 */
const BOOM_OUTPUT = 0.26;

/**
 * Volume by tier, one ramp per variant. **Neither is monotonic**, and neither
 * should be "corrected" into a monotonic curve: each peaks at the tier that is
 * meant to be the loudest and eases off above it.
 *
 * - The boom voice peaks at **Level 15-20**: [0.40, 0.60, 0.80, 1.00, 0.85]. The 20+
 *   tier is still the biggest event in the game — longest duration, lowest tone,
 *   longest echo tail, and an 808 sub layer the others do not get — so it lands
 *   on weight rather than on gain. At vol 1.5 a 20+ boom alone measured
 *   -0.2 dBFS, leaving nothing for any voice on top of it; see the trim in
 *   `playBoom`.
 * - White-on-black peaks a tier lower, at **Level 10-15**:
 *   [0.50, 0.75, 1.00, 0.85, 0.70]. It is lifted `WHITE_BLACK_LIFT` and carries
 *   a struck-metal ring, so much more of its energy sits where the ear is most
 *   sensitive; held at the ordinary boom's gain through the top tiers it stops
 *   reading as bigger and starts reading as harsh.
 */
export const BOOM_VOL_RAMP = boomVolumeRamp(3, 0.70, 0.25);
export const WHITE_BLACK_VOL_RAMP = boomVolumeRamp(2, 0.50, 0.18);

/**
 * How much of its ramp the white-on-black boom actually asks for.
 *
 * Its ramp is normalised to 1.0 like the ordinary one, so this is where the gap
 * between the two variants is set. It is lifted in pitch and carries a metal
 * ring, both of which put energy where the ear is most sensitive, so at equal
 * ramps it measured 4-10 dB above the ordinary boom of the same size and read as
 * too loud. It should be the bigger event, by a couple of dB, not by ten.
 */
const WHITE_BLACK_TRIM = 0.71;

/**
 * Tone (the scale note the dive lands on, in Hz), duration (seconds) and volume
 * for the ordinary boom voice. Tone and duration rise across every tier; volume
 * follows `BOOM_VOL_RAMP` and peaks at Level 15-20.
 */
export function getBoomProps(boomSize: number) {
  const i = boomTier(boomSize);
  return { tone: scaleNote(BOOM_STEPS[i]), dur: BOOM_DUR[i], vol: BOOM_VOL_RAMP[i] };
}

/**
 * The boom's pitch dive, all on notes of the scale: it starts high, lands
 * on the tier's note 50ms in, and glides down to the octave below. The white-on-
 * black boom lands on the scale note nearest `WHITE_BLACK_LIFT` above.
 */
export function boomPitches(boomSize: number, whiteBlack = false) {
  const tone = getBoomProps(boomSize).tone;
  const land = whiteBlack ? inKey(tone * WHITE_BLACK_LIFT) : tone;
  return { start: inKey(land * DIVE_FROM), land, end: land / 2 };
}

/**
 * Volume for the white-on-black boom, which has a ramp of its own rather than a
 * flat multiple of the ordinary one's. Peaks at Level 10-15.
 */
export function getWhiteBlackBoomVol(boomSize: number): number {
  return WHITE_BLACK_VOL_RAMP[boomTier(boomSize)];
}

/**
 * Cross-fed echo taps for the boom, scaled by how big the boom was.
 *
 * The two delays are deliberately not a simple multiple of each other, so the
 * repeats interleave into a scatter rather than lining up into one flam, and
 * each feeds the *other* side — a ping-pong that throws the boom across the
 * stereo field as it dies away. `feedback` and `tail` both grow with the chain,
 * so a 2-ball pop still ends promptly while a 20-ball boom rolls out across a
 * canyon. Feedback is ramped to zero over `tail` rather than left to decay on
 * its own: it guarantees the loop terminates, and it is what lets the node
 * cleanup below be scheduled at a known time.
 */
export function boomEchoSpec(boomSize: number, whiteBlack: boolean) {
  const size = Math.max(0, Math.min(1, boomSize / 20));
  return {
    left: 0.19 + size * 0.07,
    // Drifts from ~1.58x the left delay to ~1.65x as the chain grows: near the
    // golden ratio and, more to the point, never near 3/2 or 2, where every
    // second right-hand repeat would land on a left one and flam instead of
    // scatter. `tests/audio/Voices.test.ts` holds it off those multiples.
    right: 0.30 + size * 0.13,
    feedback: 0.30 + size * 0.30,
    // Flat across tiers. The delay times, the feedback and the tail all grow
    // with the chain — that is the drama — but the send is a *level*, and the
    // echoes tap off `trim`, downstream of the tier ramp. Growing it with chain
    // size handed the biggest booms back the loudness the ramp had just taken
    // off them, which is part of why 20+ read as loudest whatever the ramp said.
    send: 0.30 * (whiteBlack ? 1.15 : 1),
    // Metal repeats stay bright longer than a bass boom's do.
    damp: whiteBlack ? 2600 : 1400,
    tail: 1.1 + size * 2.4,
  };
}

/**
 * A white ball reaching a black one is the only way a black ever leaves the
 * table, and it takes the whole group with it. That boom gets its own voice
 * rather than the ordinary one: the pitch dive is lifted most of an octave, and
 * a struck-metal ring is layered over it. The ring's partials are deliberately
 * inharmonic (× 6 and × 9.2 of the tone) so it reads as metal shattering rather
 * than as another note in the scale, and it is routed past the boom's lowpass —
 * which sweeps down to a few hundred Hz — or nothing of it would survive.
 */
const WHITE_BLACK_LIFT = 1.8;
const WHITE_BLACK_RING = [
  { ratio: 6, amp: 0.18, decay: 0.85, pan: -0.45 },
  { ratio: 9.2, amp: 0.10, decay: 0.55, pan: 0.45 },
];

/**
 * Synthesizes a clear, punchy binaural bass boom for booms.
 * Features a rapid pitch-drop dive (startPitch -> endPitch), lowpass filter sweep,
 * soft dynamics compressor to prevent crackle, and scaling by chain size.
 * `whiteBlack` selects the lifted, ringing variant described above.
 */
export function playBoom(boomSize: number = 3, xNorm: number = 0, opts: BoomOptions = {}): boolean {
  const { ignoreOptionsGuard = false, whiteBlack = false } = opts;
  if (!voiceAllowed(ignoreOptionsGuard, { vol: AudioStore.boomVol })) return false;
  const actx = AudioStore.actx!;
  const now = actx.currentTime;
  const t = now + LOOKAHEAD.boom;
  const dest = AudioStore.master!;

  const props = getBoomProps(boomSize);
  // Each boom carries its own compressor and feedback-delay network for up to
  // ~5s. Matches peak at 4-5 at once (Chaos, Rally); past MAX_BOOMS the newest
  // is dropped rather than letting a pile-up crackle or stall a phone.
  boomEnds = boomEnds.filter(end => end > now);
  if (boomEnds.length >= MAX_BOOMS) return false;
  boomEnds.push(t + props.dur + boomEchoSpec(boomSize, whiteBlack).tail);
  // The lifted boom carries more of its energy where the ear is most sensitive,
  // so it is shortened, and takes its level from its own ramp rather than a flat
  // multiple of this one's — the two peak at different tiers on purpose.
  const dur = props.dur * (whiteBlack ? 0.85 : 1);
  const vol = whiteBlack ? getWhiteBlackBoomVol(boomSize) * WHITE_BLACK_TRIM : props.vol;
  // Every tier drives the compressor at the SAME level. The tier ramp and the
  // user's boom knob are applied downstream of it instead, on `trim`.
  //
  // They used to be applied here, and the ramp then did essentially nothing:
  // with the threshold at -14 dB and a 4.5:1 ratio, every tier sat 10-13 dB into
  // compression, so the ramp's full 8 dB spread arrived at the output as 1.8 dB
  // and the step from Level 15-20 to 20+ arrived as 0.31 dB. What was left to
  // separate the tiers was everything the compressor does not touch — duration,
  // the 808 sub layer, the echo send — and all of those grow with chain size, so
  // 20+ came out loudest however the ramp was written. Post-compressor, the ramp
  // lands 1:1.
  const peak = BOOM_DRIVE;

  const { start: startPitch, land: midPitch, end: endPitch } = boomPitches(boomSize, whiteBlack);

  const parts: (AudioNode & { stop?: () => void })[] = [];

  // Soft dynamics compressor prevents digital clipping crackle while allowing massive bass punch
  const comp = actx.createDynamicsCompressor();
  parts.push(comp);
  comp.threshold.setValueAtTime(-14, t);
  comp.knee.setValueAtTime(18, t);
  comp.ratio.setValueAtTime(4.5, t);
  comp.attack.setValueAtTime(0.005, t);
  comp.release.setValueAtTime(0.15, t);

  // Trim after the compressor, and the only place the tier ramp is applied. The
  // compressor's automatic makeup gain hands back most of any cut made upstream
  // of it, so a level that must actually be heard has to be set here.
  const trim = actx.createGain();
  parts.push(trim);
  trim.gain.value = BOOM_OUTPUT * vol * AudioStore.boomVol;
  // The low cut, between the compressor and the trim so the echo tap downstream
  // carries the same shape. Two 12 dB/oct stages: one leaves too much of the
  // octave below the cut for a phone speaker to cope with. Everything below it
  // goes, including the 808 sub layer of the top tiers unless the knob is taken
  // down to meet it.
  const cut = Math.max(20, AudioStore.boomCut);
  let lowCut: AudioNode = comp;
  for (let stage = 0; stage < 2; stage++) {
    const hp = actx.createBiquadFilter();
    parts.push(hp);
    hp.type = 'highpass';
    hp.frequency.value = cut;
    hp.frequency.setValueAtTime(cut, now);
    hp.Q.setValueAtTime(0.7, now);
    lowCut.connect(hp);
    lowCut = hp;
  }
  lowCut.connect(trim);
  trim.connect(dest);

  // Echo network. It taps the boom post-trim, so the repeats carry the shape the
  // listener actually heard, and it returns to `dest` on its own path rather than
  // back through `comp` — routed through the compressor the repeats would pump
  // the dry boom down every time one landed.
  const echo = boomEchoSpec(boomSize, whiteBlack);
  const echoEnd = t + dur + echo.tail;
  const delayL = actx.createDelay(1.0);
  const delayR = actx.createDelay(1.0);
  const fbL = actx.createGain();
  const fbR = actx.createGain();
  const dampL = actx.createBiquadFilter();
  const dampR = actx.createBiquadFilter();
  const send = actx.createGain();
  parts.push(delayL, delayR, fbL, fbR, dampL, dampR, send);

  delayL.delayTime.setValueAtTime(echo.left, t);
  delayR.delayTime.setValueAtTime(echo.right, t);
  for (const d of [dampL, dampR]) {
    d.type = 'lowpass';
    d.frequency.setValueAtTime(echo.damp, t);
    d.Q.value = 0.7;
  }
  // Each repeat loses its top end, the way a real one loses it to the air.
  for (const f of [fbL, fbR]) {
    f.gain.setValueAtTime(echo.feedback, t);
    f.gain.setValueAtTime(echo.feedback, t + dur);
    f.gain.linearRampToValueAtTime(0, echoEnd);
  }
  send.gain.value = SILENCE;
  send.gain.setValueAtTime(SILENCE, now);
  send.gain.linearRampToValueAtTime(echo.send, t + 0.02);

  trim.connect(send);
  send.connect(delayL);
  send.connect(delayR);
  // Cross-fed: each side's repeat re-enters on the opposite side.
  delayL.connect(dampL); dampL.connect(fbL); fbL.connect(delayR);
  delayR.connect(dampR); dampR.connect(fbR); fbR.connect(delayL);

  if (actx.createStereoPanner) {
    const panEchoL = actx.createStereoPanner();
    const panEchoR = actx.createStereoPanner();
    parts.push(panEchoL, panEchoR);
    panEchoL.pan.setValueAtTime(-0.75, t);
    panEchoR.pan.setValueAtTime(0.75, t);
    dampL.connect(panEchoL); panEchoL.connect(dest);
    dampR.connect(panEchoR); panEchoR.connect(dest);
  } else {
    dampL.connect(dest);
    dampR.connect(dest);
  }

  // The boom had no reverb at all before: it was the one voice wired straight
  // past the wet bus. A send from the echo taps, rather than from the dry boom,
  // puts the room behind the repeats where it reads as distance.
  if (AudioStore.wetBus) {
    dampL.connect(AudioStore.wetBus);
    dampR.connect(AudioStore.wetBus);
  }

  // Struck-metal ring for the white-on-black boom. It joins at the compressor
  // rather than at `lp`, so the boom's downward filter sweep does not swallow it,
  // while the compressor still holds the pair together on the way out.
  if (whiteBlack) {
    for (const mode of WHITE_BLACK_RING) {
      const osc = actx.createOscillator();
      const g = actx.createGain();
      parts.push(osc, g);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(midPitch * mode.ratio, t);
      // A slight downward drift over the tail: struck metal sags as it rings out.
      rampFreq(osc.frequency, midPitch * mode.ratio * 0.97, t + mode.decay);
      g.gain.value = SILENCE;
      g.gain.setValueAtTime(SILENCE, now);
      g.gain.setValueAtTime(SILENCE, t);
      g.gain.linearRampToValueAtTime(Math.max(SILENCE, peak * mode.amp), t + 0.004);
      g.gain.exponentialRampToValueAtTime(SILENCE, t + mode.decay);
      g.gain.linearRampToValueAtTime(0, t + mode.decay + 0.02);
      osc.connect(g);
      panned(g, comp, Math.max(-1, Math.min(1, xNorm * 0.5 + mode.pan)), t, parts);
      osc.start(t);
      osc.stop(t + mode.decay + 0.05);
    }
  }

  // Lowpass filter sweep: starts wide for initial boom impact punch, closes into resonant sub tail
  const lp = actx.createBiquadFilter();
  parts.push(lp);
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(startPitch * 2.2, now);
  lp.frequency.setValueAtTime(startPitch * 2.2, t);
  rampFreq(lp.frequency, midPitch * 2.4, t + 0.05);
  rampFreq(lp.frequency, endPitch * 1.6, t + dur);
  lp.Q.setValueAtTime(1.1, t);
  lp.connect(comp);

  // Boom gain envelope: fast punch attack, body sustain, smooth clean decay
  const env = actx.createGain();
  parts.push(env);
  env.gain.value = SILENCE;
  env.gain.setValueAtTime(SILENCE, now);
  env.gain.setValueAtTime(SILENCE, t);
  env.gain.linearRampToValueAtTime(Math.max(SILENCE, peak), t + 0.014);
  env.gain.linearRampToValueAtTime(Math.max(SILENCE, peak * 0.82), t + 0.06);
  env.gain.linearRampToValueAtTime(Math.max(SILENCE, peak * 0.40), t + dur * 0.55);
  env.gain.linearRampToValueAtTime(SILENCE, t + dur);
  env.gain.linearRampToValueAtTime(0, t + dur + 0.04);
  env.connect(lp);

  // The 808 sub layer the top tiers used to carry is gone. It ran an octave under
  // the dive, 21-58 Hz, which is below the low cut and below what a phone can
  // reproduce: inaudible there, and pure cone excursion — part of what made booms
  // crackle. On headphones it was also fighting the dive it doubled, so taking it
  // out *raised* the measured level of a 20+ boom rather than thinning it.

  // Harmonics of the dive, ×2 and ×3, placed after the low cut so it cannot take
  // them away. A phone speaker reproduces almost nothing below ~500 Hz, so the
  // dive's own fundamental is both inaudible and what makes the cone crackle;
  // these put the same pitch where the speaker works. The ear hears the pitch of
  // a harmonic series from its partials even when the fundamental is missing, so
  // the boom keeps its depth on a phone and gains a little bite on headphones.
  for (const h of BOOM_HARMONICS) {
    const osc = actx.createOscillator();
    const g = actx.createGain();
    parts.push(osc, g);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startPitch * h.ratio, t);
    rampFreq(osc.frequency, midPitch * h.ratio, t + 0.05);
    rampFreq(osc.frequency, endPitch * h.ratio, t + dur);
    g.gain.value = SILENCE;
    g.gain.setValueAtTime(SILENCE, now);
    g.gain.setValueAtTime(SILENCE, t);
    g.gain.linearRampToValueAtTime(Math.max(SILENCE, peak * h.amp), t + 0.02);
    g.gain.linearRampToValueAtTime(Math.max(SILENCE, peak * h.amp * 0.45), t + dur * 0.55);
    g.gain.linearRampToValueAtTime(SILENCE, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.04);
    osc.connect(g);
    g.connect(trim);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // Left binaural channel oscillator with rapid pitch-drop sweep
  const leftOsc = actx.createOscillator();
  parts.push(leftOsc);
  leftOsc.type = 'sine';
  const startL = startPitch - BEAT / 2;
  const midL = midPitch - BEAT / 2;
  const endL = endPitch - BEAT / 2;
  leftOsc.frequency.setValueAtTime(startL, t);
  rampFreq(leftOsc.frequency, midL, t + 0.05);
  rampFreq(leftOsc.frequency, endL, t + dur);

  panned(leftOsc, env, Math.max(-1, Math.min(1, xNorm * 0.7 - 0.35)), t, parts);
  leftOsc.start(t);
  leftOsc.stop(t + dur + 0.05);

  // Right binaural channel oscillator with rapid pitch-drop sweep
  const rightOsc = actx.createOscillator();
  parts.push(rightOsc);
  rightOsc.type = 'sine';
  const startR = startPitch + BEAT / 2;
  const midR = midPitch + BEAT / 2;
  const endR = endPitch + BEAT / 2;
  rightOsc.frequency.setValueAtTime(startR, t);
  rampFreq(rightOsc.frequency, midR, t + 0.05);
  rampFreq(rightOsc.frequency, endR, t + dur);

  panned(rightOsc, env, Math.max(-1, Math.min(1, xNorm * 0.7 + 0.35)), t, parts);
  rightOsc.start(t);
  // This oscillator drives the cleanup below, so it outlives the boom by the
  // echo tail. Its envelope reached zero back at `t + dur`, so the extra time is
  // silent — it costs one idle oscillator to keep the teardown on `onended`
  // rather than on a timer the audio clock does not govern. Tearing the graph
  // down at the boom's own end would cut every repeat off with it.
  rightOsc.stop(echoEnd + 0.1);

  disposeWhenEnded(rightOsc, parts);
  return true;
}

/**
 * Chain sizes a boom can actually have, one entry per tier of
 * `getBoomProps`, and how often each is drawn.
 *
 * The weights are shaped from what the harness measures the game doing:
 * `npm run sim -- run --runs 12 --mode solo` gives a mean boom of about 3.8
 * balls, a biggest-boom-per-minute averaging 10.7, and a largest group ever
 * built of 19 — so small booms dominate, ten-ball booms are a highlight of a
 * round, and twenty is the edge of what the shipped AI reaches.
 *
 * `menu` keeps that shape but lifts the tail: a true match distribution would
 * be about 80% smallest-tier, and an attract screen that plays the same small
 * boom eight times running is not previewing the game's range. `celebration`
 * leans the other way on purpose — the results screen is a victory lap, so it
 * should mostly be playing the big ones.
 *
 * Measured with `--policy engine-ai`, which aims at the biggest group and
 * never checks whether the line is clear. It cannot represent shot selection, so
 * a player who picks shots well may well build past 20 more often than this.
 */
const BOOM_TIERS: { lo: number; hi: number }[] = [
  { lo: 2, hi: 4 },
  { lo: 5, hi: 9 },
  { lo: 10, hi: 14 },
  { lo: 15, hi: 19 },
  { lo: 20, hi: 26 },
];

const BOOM_PROFILES = {
  menu: { weights: [0.50, 0.26, 0.14, 0.07, 0.03], whiteBlack: 0.12 },
  celebration: { weights: [0.16, 0.24, 0.26, 0.22, 0.12], whiteBlack: 0.28 },
};

export type BoomProfile = keyof typeof BOOM_PROFILES;

/** Pick a chain size and variant a real match could have produced. */
export function pickGameBoom(profile: BoomProfile, rand: () => number = Math.random) {
  const { weights, whiteBlack } = BOOM_PROFILES[profile];
  let r = rand();
  let tier = weights.length - 1;
  for (let i = 0; i < weights.length; i++) {
    if (r < weights[i]) { tier = i; break; }
    r -= weights[i];
  }
  const { lo, hi } = BOOM_TIERS[tier];
  return {
    boomSize: lo + Math.floor(rand() * (hi - lo + 1)),
    // Only a white ball reaching a black produces this one, so it stays a
    // garnish rather than the house style, even on the results screen.
    whiteBlack: rand() < whiteBlack,
  };
}

/**
 * How many attract-screen booms may be ringing at once.
 *
 * In a match, booms are limited by how often a group can actually be broken.
 * The attract screens fire on a timer instead, and `playBoom` has no
 * voice cap of its own — so at the results screen's cadence, with a top-tier
 * boom running 1.4s and trailing an echo tail of up to 3.5s behind it, five or
 * six can overlap. That is both a mud problem and a real CPU cost on a phone,
 * since every one of them carries its own feedback delay network.
 */
const MAX_ATTRACT_BOOMS = 3;
let attractBoomEnds: number[] = [];
/** Booms ringing anywhere, menu or match: a safety cap well above a match's peak of 4-5. */
const MAX_BOOMS = 6;
let boomEnds: number[] = [];

/** Drop the boom bookkeeping. Tests use this between cases. */
export function resetAttractBooms() {
  attractBoomEnds = [];
  boomEnds = [];
}
// The ends are on the old context's clock, which a rebuild starts again at zero.
onAudioRebuild(resetAttractBooms);

/**
 * Play one boom the game could really have made, for the attract screens.
 *
 * The title and results screens both used to call `playNote(..., 'boom')` with
 * no chain size, which defaults to 3 — so every boom either screen ever played
 * was the smallest tier, and the whole upper range of the sound was invisible
 * outside a match.
 */
export function playRandomGameBoom(xNorm: number, profile: BoomProfile, opts: { ignoreOptionsGuard?: boolean } = {}) {
  const { ignoreOptionsGuard = false } = opts;
  const boom = pickGameBoom(profile);
  const actx = AudioStore.actx;
  if (!actx) return;
  const now = actx.currentTime;
  attractBoomEnds = attractBoomEnds.filter((end) => end > now);
  if (attractBoomEnds.length >= MAX_ATTRACT_BOOMS) return;
  // A slot is taken only by a boom that plays. Reserving it first let refused
  // booms — context still stopped before the first tap, Options open, boom
  // volume 0 — hold every slot for ~5s of audio clock, so the menu stayed
  // silent for a while after the first tap.
  if (!playBoom(boom.boomSize, xNorm, { ignoreOptionsGuard, whiteBlack: boom.whiteBlack })) return;
  const props = getBoomProps(boom.boomSize);
  attractBoomEnds.push(now + props.dur + boomEchoSpec(boom.boomSize, boom.whiteBlack).tail);
}

export function playNote(rel: number, xNorm: number, kind: 'bond' | 'break' | 'boom', opts: NoteOptions = {}) {
  const { boost, boomSize, ignoreOptionsGuard = false, whiteBlack = false } = opts;
  if (!voiceAllowed(ignoreOptionsGuard)) return;
  if (kind === 'boom') {
    playBoom(boomSize ?? 3, xNorm, { ignoreOptionsGuard, whiteBlack });
    return;
  }

  const actx = AudioStore.actx!;
  if (AudioStore.activeVoices >= MAX_VOICES) return;

  const spec = kind === 'bond' ? BOND_VOICE : BREAK_VOICE;
  const now = actx.currentTime;

  const spacing = Math.min(0.2, 0.025 + loadAt_(now) * 0.035);
  if (AudioStore.cursor < now || AudioStore.cursor > now + 0.5) AudioStore.cursor = now;
  const t = Math.max(now + LOOKAHEAD.note, AudioStore.cursor + spacing);
  if (t > now + 0.3) return;
  AudioStore.cursor = t;

  const i = scaleDegree(rel);
  const f = SCALE_NOTES[i] * spec.mul;
  const beat = BEAT + (i % 3) * 0.4;
  const busy = loadAt_(t);
  const duck = 1 / (1 + busy * 0.8);
  if (duck < 0.1) return;

  AudioStore.load = busy + duck;
  AudioStore.loadAt = t;

  const dur = (spec.dur + Math.random() * spec.jitter) * (0.45 + 0.55 * duck);
  const level = kind === 'bond' ? AudioStore.lockVol : AudioStore.breakVol;
  if (level <= 0) return;

  // Haptics fire here, past every condition that can still drop this note. Fired
  // any earlier they buzz for notes the mixer deliberately discarded — which is
  // exactly when the engine is busiest and the least able to afford it.
  if (kind === 'bond') triggerHaptic('light');
  else if (kind === 'break') triggerHaptic('medium');
  const peak = spec.peak * duck * (1 - i * 0.03) * level * (boost || 1);

  const parts: any[] = [];

  const env = actx.createGain();
  parts.push(env);
  env.gain.value = SILENCE;
  env.gain.setValueAtTime(SILENCE, now);
  env.gain.setValueAtTime(SILENCE, t);
  env.gain.linearRampToValueAtTime(Math.max(SILENCE, peak), t + spec.attack);
  env.gain.linearRampToValueAtTime(SILENCE, t + dur);
  env.gain.linearRampToValueAtTime(0, t + dur + 0.03);

  const lp = actx.createBiquadFilter();
  parts.push(lp);
  lp.type = 'lowpass';
  lp.frequency.value = spec.open;
  lp.frequency.setValueAtTime(spec.open, now);
  lp.frequency.setValueAtTime(spec.open, t);
  rampFreq(lp.frequency, spec.close, t + dur * 0.7);
  lp.Q.value = 0.6;

  env.connect(lp);
  const dry = actx.createGain(); parts.push(dry);
  dry.gain.value = spec.dry || 0.62;
  lp.connect(dry); dry.connect(AudioStore.master!);
  if (AudioStore.wetBus) lp.connect(AudioStore.wetBus);

  const oscs: OscillatorNode[] = [];
  [[-1, f, 1 - 0.3 * xNorm], [1, f + beat, 1 + 0.3 * xNorm]].forEach(([side, freq, bias]) => {
    const w = Math.max(0.35, bias) * 0.5;
    let dest: AudioNode = env;
    dest = panInto(env, side, parts);
    for (const [ratio, amt] of spec.partials) {
      const o = actx.createOscillator(), g = actx.createGain();
      parts.push(o, g);
      o.type = 'sine'; o.frequency.value = freq * ratio;
      rampFreq(o.frequency, freq * ratio * 0.995, t + dur);
      g.gain.value = amt * w;
      o.connect(g); g.connect(dest);
      o.start(t); o.stop(t + dur + 0.05);
      oscs.push(o);
    }
  });

  if (spec.tick && AudioStore.noiseBuf) {
    const src = actx.createBufferSource();
    src.buffer = AudioStore.noiseBuf;
    src.loop = true;
    const bp = actx.createBiquadFilter();
    parts.push(src, bp);
    bp.type = 'bandpass';
    bp.frequency.value = f * 1.6;
    bp.frequency.setValueAtTime(f * 1.6, now);
    bp.frequency.setValueAtTime(f * 1.6, t);
    bp.Q.value = 1.4;
    const ng = actx.createGain();
    parts.push(ng);
    ng.gain.value = SILENCE;
    ng.gain.setValueAtTime(SILENCE, now);
    ng.gain.setValueAtTime(Math.max(SILENCE, peak * spec.tick), t);
    ng.gain.linearRampToValueAtTime(SILENCE, t + 0.05);
    ng.gain.linearRampToValueAtTime(0, t + 0.07);
    src.connect(bp); bp.connect(ng); ng.connect(lp);
    src.start(t); src.stop(t + 0.09);
  }

  AudioStore.activeVoices++;
  const endSignalNode = oscs.length ? oscs[oscs.length - 1] : null;
  if (endSignalNode) {
    disposeWhenEnded(endSignalNode, parts, () => {
      AudioStore.activeVoices = Math.max(0, AudioStore.activeVoices - 1);
    });
  }
}

/**
 * How big the magnet lock sounds, by the size of the group the lock produced.
 *
 * The same five tiers the boom voice uses (`getBoomProps`), so a lock
 * and the boom that later takes the same group apart are heard on one scale:
 * a ball joining a pair is a tick, a ball closing a twenty-ball group is a
 * long magnetic groan.
 *
 * Duration carries most of that. It spans a factor of five across the tiers,
 * 0.24s to 1.20s, because length is what makes one of these read as a big event
 * — an earlier version spread it only 0.18s to 0.38s and was far too timid for
 * the top tiers. The arc, its filters and the suction sub all sweep across the
 * whole duration, so a long one is a slow descending groan rather than the same
 * zap held out.
 *
 * Level moves weight and length only. It deliberately does not move pitch,
 * which is what separates a single black from a pair (`PAIR_LIFT`); if level
 * moved pitch too, a big single-black lock and a small black-pair lock would
 * collide.
 */
export function getMagnetLockProps(groupSize: number) {
  if (groupSize >= 20) return { dur: 1.20, vol: 1.95, sub: 2.30, drive: 2.20 };
  if (groupSize >= 15) return { dur: 0.88, vol: 1.68, sub: 2.00, drive: 1.90 };
  if (groupSize >= 10) return { dur: 0.62, vol: 1.45, sub: 1.70, drive: 1.60 };
  if (groupSize >= 5) return { dur: 0.40, vol: 1.18, sub: 1.38, drive: 1.32 };
  return { dur: 0.24, vol: 0.88, sub: 1.0, drive: 1.0 };
}

/**
 * Two blacks locking to each other is the rarest bond on the table and pays
 * double a single black (`PAY_BLACK_PAIR`), so it reads as *more* than the
 * ordinary magnet lock in every dimension: higher, longer, and louder.
 * `PAIR_LIFT` moves the arc and its filters; the suction sub follows at
 * `PAIR_SUB_LIFT`, less far, so the lock keeps weight underneath instead of
 * thinning out into a whistle.
 *
 * The lift was an octave (2.0) until the whole voice was found too shrill. An
 * octave above an arc that already started at 2.4 kHz put the pair's resonance
 * at 10 kHz, which made the rarest event on the table also the most piercing.
 * It is a fifth now (1.5), which still separates the two clearly — the point of
 * the lift is that a pair is recognisable, not that it is high.
 *
 * An earlier version had the pair at 0.8x the duration and 0.8x the level of a
 * single black, on the reasoning that it was the snappier sound by character and
 * that its lifted arc sits nearer the ear's most sensitive band, where it would
 * otherwise read louder than the lock beside it. That is defensible mixing and
 * was still wrong here: it made the rarest event on the table the meekest one.
 * The pair now runs longer and louder than a single black at the same tier, and
 * grows with the chain the same way.
 */
export const PAIR_LIFT = 1.5;
export const PAIR_SUB_LIFT = 1.25;
export const PAIR_DUR = 1.25;
export const PAIR_VOL = 1.2;

/**
 * IEC 61672 A-weighting as a power ratio, 1 at 1 kHz: how much of a tone at
 * `freq` the ear actually hears, relative to the same level at 1 kHz.
 */
export function aWeightPower(freq: number): number {
  const f2 = freq * freq;
  const ra = (12194 ** 2 * f2 * f2) /
    ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  // The standard's +2.00 dB is what brings the curve to exactly 0 dB at 1 kHz.
  const g = ra * Math.pow(10, 2.0 / 20);
  return g * g;
}

/**
 * Where the magnet lock's arc carries its energy at `lockTone` 1, for the
 * purpose of keeping it equally loud as the knob moves it.
 *
 * Lowering `lockTone` moves the arc down, and below about 1 kHz the ear hears
 * steeply less of the same level: at 0.3 the single lock measured 4.6 dB quieter,
 * A-weighted, than it first shipped, though its peak had not moved. The energy
 * was still there, 6.4 dB lower in the 500 Hz-4 kHz band and 6.6 dB higher
 * under 500 Hz. Treating the arc as centred on this frequency and restoring
 * what A-weighting takes off it reproduces the measured shortfall across
 * `lockTone` 0.15-0.8 to within 0.29 dB rms. Fitted, not chosen.
 */
export const LOCK_ARC_CENTRE = 2000;

/**
 * Level the arc lost when the lowpass Q came down from 8 to 4.5, put back.
 *
 * The resonant peak was part of the arc's loudness: with the Q lowered and
 * nothing else changed, the lock measured 2.2 dB quieter, A-weighted.
 */
export const LOCK_ARC_MAKEUP = 1.29;

/**
 * Gain on the magnet lock's arc and noise sizzle, so `lockTone` changes what
 * the lock sounds like and not how loud it is.
 *
 * Only the arc: the suction sub was never moved by the knob and did not get
 * quieter, and a whole-voice correction handed it the arc's make-up too — at
 * `lockTone` 0.3 that put the 20+ tier 5.1 dB over the voice as it first
 * shipped. Arc-only, the tiers land at -0.0 / +0.3 / +1.7 dB (0-4, 10-14, 20+)
 * and a black pair at +1.8 dB. Measured by rendering this voice through the
 * master chain in an OfflineAudioContext against the pre-change voice.
 */
export function lockArcGain(tone: number): number {
  return LOCK_ARC_MAKEUP *
    Math.sqrt(aWeightPower(LOCK_ARC_CENTRE) / aWeightPower(LOCK_ARC_CENTRE * tone));
}

export function playMagneticElectricSound(xNorm: number = 0, opts: MagnetLockOptions = {}) {
  const { ignoreOptionsGuard = false, isPair = false, groupSize = 2 } = opts;
  if (!voiceAllowed(ignoreOptionsGuard)) return;
  const actx = AudioStore.actx!;
  if (AudioStore.activeVoices >= MAX_VOICES) return;

  // `lockTone` scales the arc and its filters but not the suction sub below, so
  // turning it down moves the voice's weight onto the sub rather than only
  // taking brightness away. See `AudioStore.lockTone`.
  const lift = (isPair ? PAIR_LIFT : 1) * AudioStore.lockTone;
  const subLift = isPair ? PAIR_SUB_LIFT : 1;
  const level = getMagnetLockProps(groupSize);
  const arcGain = lockArcGain(AudioStore.lockTone);

  const now = actx.currentTime;
  const t = now + LOOKAHEAD.short;
  const dur = level.dur * (isPair ? PAIR_DUR : 1);
  // Kept under the bond lock: the square-wave arc used to sit at 2-5 kHz, where
  // it reads louder than its measured level against the lower game voices.
  // `lockTone` now moves that band down instead of trimming the level for it.
  // The pair is still not trimmed — see `PAIR_LIFT` above.
  const peak = 0.027 * AudioStore.lockVol * level.vol * (isPair ? PAIR_VOL : 1);
  if (peak <= 0.001) return;

  triggerHaptic('light');

  const parts: (AudioNode & { stop?: () => void })[] = [];

  // Master gain envelope for magnetic electric sound: double micro-spark pulse profile
  const env = actx.createGain();
  parts.push(env);
  env.gain.value = SILENCE;
  env.gain.setValueAtTime(SILENCE, now);
  env.gain.setValueAtTime(SILENCE, t);
  env.gain.linearRampToValueAtTime(Math.max(SILENCE, peak), t + 0.003);
  env.gain.linearRampToValueAtTime(Math.max(SILENCE, peak * 0.4), t + 0.020);
  env.gain.linearRampToValueAtTime(Math.max(SILENCE, peak * 0.75), t + 0.035);
  env.gain.linearRampToValueAtTime(SILENCE, t + dur);
  env.gain.linearRampToValueAtTime(0, t + dur + 0.03);

  // Highpass / bandpass electrical arc filter for sharp sizzle
  const hp = actx.createBiquadFilter();
  parts.push(hp);
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(1400 * lift, now);
  hp.frequency.setValueAtTime(1400 * lift, t);
  rampFreq(hp.frequency, 400 * lift, t + dur);

  // Resonant lowpass filter sweep: electric brightness (5200Hz) snapping down into magnetic seal (650Hz)
  const lp = actx.createBiquadFilter();
  parts.push(lp);
  lp.type = 'lowpass';
  // Q 8 put a narrow resonant peak on the filter's own corner, which is heard as
  // a whistle riding the sweep rather than as the arc getting brighter. 4.5 still
  // gives the snap-shut an audible edge without the tone on top of it.
  lp.Q.value = 4.5;
  lp.frequency.setValueAtTime(5200 * lift, now);
  lp.frequency.setValueAtTime(5200 * lift, t);
  rampFreq(lp.frequency, 1600 * lift, t + 0.04);
  rampFreq(lp.frequency, 650 * lift, t + dur);

  env.connect(hp);
  hp.connect(lp);

  const dry = actx.createGain();
  parts.push(dry);
  dry.gain.value = 0.65;
  lp.connect(dry);

  panned(dry, AudioStore.master!, Math.max(-1, Math.min(1, xNorm || 0)) * 0.7, undefined, parts);
  if (AudioStore.wetBus) lp.connect(AudioStore.wetBus);

  // 1. High Sizzling Electric FM Zap (Square + Sawtooth ring mod arc, 2400Hz -> 450Hz)
  const carrier = actx.createOscillator();
  const modOsc = actx.createOscillator();
  const modGain = actx.createGain();
  parts.push(carrier, modOsc, modGain);

  carrier.type = 'square';
  carrier.frequency.setValueAtTime(inKey(2400 * lift), t);
  rampFreq(carrier.frequency, inKey(450 * lift), t + dur);

  modOsc.type = 'sawtooth';
  modOsc.frequency.setValueAtTime(220 * lift, t);
  rampFreq(modOsc.frequency, 85 * lift, t + dur);

  modGain.gain.setValueAtTime(1200 * lift * level.drive, t);
  rampFreq(modGain.gain, 150 * lift * level.drive, t + dur);

  modOsc.connect(modGain);
  modGain.connect(carrier.frequency);

  const carrierGain = actx.createGain();
  parts.push(carrierGain);
  carrierGain.gain.value = 0.40 * arcGain;
  carrier.connect(carrierGain);
  carrierGain.connect(env);

  modOsc.start(t);
  modOsc.stop(t + dur + 0.05);
  carrier.start(t);
  carrier.stop(t + dur + 0.05);

  // 2. High Voltage Sparkle Discharge Arc (Filtered high frequency noise sizzle "zzzt!")
  if (AudioStore.noiseBuf) {
    const src = actx.createBufferSource();
    src.buffer = AudioStore.noiseBuf;
    src.loop = true;
    const bp = actx.createBiquadFilter();
    const ng = actx.createGain();
    parts.push(src, bp, ng);

    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(Math.min(16000, 4800 * lift), t);
    rampFreq(bp.frequency, Math.min(16000, 2200 * lift), t + 0.07);
    bp.Q.value = 6.0;

    ng.gain.value = SILENCE;
    ng.gain.setValueAtTime(SILENCE, now);
    ng.gain.setValueAtTime(peak * 0.45 * arcGain, t);
    ng.gain.linearRampToValueAtTime(SILENCE, t + 0.06);
    ng.gain.linearRampToValueAtTime(0, t + 0.08);

    src.connect(bp);
    bp.connect(ng);
    ng.connect(lp);
    src.start(t);
    src.stop(t + 0.09);
  }

  // 3. Soft Magnetic Suction Sub Drop (130Hz -> 320Hz -> 90Hz)
  const subOsc = actx.createOscillator();
  const subGain = actx.createGain();
  parts.push(subOsc, subGain);

  subOsc.type = 'sine';
  subOsc.frequency.setValueAtTime(inKey(130 * subLift), t);
  rampFreq(subOsc.frequency, inKey(320 * subLift), t + 0.03);
  rampFreq(subOsc.frequency, inKey(90 * subLift), t + dur);

  subGain.gain.value = SILENCE;
  subGain.gain.setValueAtTime(SILENCE, now);
  subGain.gain.setValueAtTime(SILENCE, t);
  subGain.gain.linearRampToValueAtTime(peak * 0.45 * level.sub, t + 0.015);
  subGain.gain.linearRampToValueAtTime(SILENCE, t + dur);
  subGain.gain.linearRampToValueAtTime(0, t + dur + 0.03);

  subOsc.connect(subGain);
  subGain.connect(lp);
  subOsc.start(t);
  subOsc.stop(t + dur + 0.05);

  AudioStore.activeVoices++;
  disposeWhenEnded(carrier, parts, () => {
    AudioStore.activeVoices = Math.max(0, AudioStore.activeVoices - 1);
  });
}

/** A 0..1 position to an index into the ten-note `SCALE_NOTES`. */
export function scaleDegree(rel: number): number {
  const validRel = isNaN(rel) ? 0.5 : rel;
  return Math.max(0, Math.min(9, Math.floor(validRel * 10)));
}

/** The position `scaleDegree` maps back to `degree`: the middle of its slot. */
export function relOfDegree(degree: number): number {
  return (degree + 0.5) / 10;
}

/**
 * Mode ratios of a free metal bar — 1 : 2.76 : 5.40 : 8.93.
 *
 * These are what make something read as *metal* rather than as a pitch: they
 * are inharmonic, so the ear hears a struck object instead of a note, and no
 * amount of filtering a noise sweep reproduces that. Driving a bank of narrow
 * bandpasses at these ratios with noise excites the same modes a real plate has.
 * Higher modes get a tighter Q and less level, the way a real bar's do.
 */
export const SWOOSH_METAL_MODES = [
  { ratio: 1, q: 11, amp: 1.0 },
  { ratio: 2.76, q: 14, amp: 0.62 },
  { ratio: 5.4, q: 17, amp: 0.34 },
  { ratio: 8.93, q: 20, amp: 0.16 },
];

/**
 * The white cue ball's launch: a metal sheet being swung.
 *
 * Built apart from the coloured swoosh because it is a different instrument, not
 * a brighter setting of the same one. Two independent mode banks are driven from
 * one noise source and hard-panned, their resonances offset by `BEAT` Hz — the
 * same binaural construction as the drone and the boom voice. The previous white
 * swoosh summed to a single mono chain and placed it with one panner, so despite
 * sitting in a game built on binaural voices it had no width of its own at all.
 *
 * `xNorm` still biases the two sides rather than collapsing them, so the launch
 * keeps its position on the table without giving up the spread.
 */
function playWhiteSwoosh(xNorm: number, normForce: number) {
  const actx = AudioStore.actx!;
  const now = actx.currentTime;
  const t = now + LOOKAHEAD.brief;
  const dur = 0.34;
  // Metal does not stop when the swing does. The banks ring on past the sweep
  // instead of being cut off at `dur`, which is most of what made the first
  // version of this read as timid: it ended exactly when it stopped moving.
  const ring = 0.18;

  // Narrow bandpasses pass far less of the noise than a wide lowpass does, so
  // this runs well above the level the old mono swoosh used for the same swing.
  const peak = 0.125 * Math.max(0.15, normForce) * AudioStore.clickVol;
  if (peak < 0.001) return;

  triggerHaptic('heavy');

  // The swing: modes rise as the ball is thrown, then fall away behind it. A
  // wider arc travelled faster is the difference between a swing and a wave.
  // The metal-bar mode ratios stay inharmonic; the fundamental they sit on
  // follows the scale.
  const baseStart = inKey(460), baseMid = inKey(1700), baseEnd = inKey(560);
  const bias = Math.max(-1, Math.min(1, xNorm || 0));

  const parts: any[] = [];

  const src = actx.createBufferSource();
  parts.push(src);
  src.buffer = AudioStore.noiseBuf;
  src.loop = true;
  src.playbackRate.value = 1.9;

  const g = actx.createGain();
  parts.push(g);
  g.gain.value = SILENCE;
  g.gain.setValueAtTime(SILENCE, now);
  g.gain.setValueAtTime(SILENCE, t);
  g.gain.linearRampToValueAtTime(Math.max(SILENCE, peak), t + 0.018);
  g.gain.linearRampToValueAtTime(Math.max(SILENCE, peak * 0.80), t + dur * 0.55);
  g.gain.linearRampToValueAtTime(Math.max(SILENCE, peak * 0.30), t + dur);
  g.gain.exponentialRampToValueAtTime(SILENCE, t + dur + ring);
  g.gain.linearRampToValueAtTime(0, t + dur + ring + 0.03);
  src.connect(g);

  // Onset scrape: a few milliseconds of very bright noise, above every mode, for
  // the initial bite of metal being struck. Without it the banks fade up into
  // the swing rather than being hit into it.
  const scrapeSrc = actx.createBufferSource();
  const scrapeBp = actx.createBiquadFilter();
  const scrapeG = actx.createGain();
  parts.push(scrapeSrc, scrapeBp, scrapeG);
  scrapeSrc.buffer = AudioStore.noiseBuf;
  scrapeSrc.loop = true;
  scrapeSrc.playbackRate.value = 2.6;
  scrapeBp.type = 'bandpass';
  scrapeBp.Q.value = 1.1;
  scrapeBp.frequency.setValueAtTime(6200, t);
  rampFreq(scrapeBp.frequency, 3100, t + 0.09);
  scrapeG.gain.value = SILENCE;
  scrapeG.gain.setValueAtTime(SILENCE, now);
  scrapeG.gain.setValueAtTime(Math.max(SILENCE, peak * 0.5), t);
  scrapeG.gain.exponentialRampToValueAtTime(SILENCE, t + 0.075);
  scrapeG.gain.linearRampToValueAtTime(0, t + 0.1);
  scrapeSrc.connect(scrapeBp);
  scrapeBp.connect(scrapeG);
  scrapeSrc.start(t, Math.random() * 0.1);
  scrapeSrc.stop(t + 0.12);

  // One bank per ear. Detuning them by BEAT Hz at every mode is what produces
  // the beating; panning alone would only place a mono sound.
  for (const side of [-1, 1]) {
    let dest: AudioNode = AudioStore.master!;
    // Hard-ish sides, nudged by where on the table the throw happened.
    dest = panInto(dest, Math.max(-1, Math.min(1, side * 0.85 + bias * 0.15)), parts);
    // A side kept slightly quieter reads as further away, which is the pan.
    const sideGain = actx.createGain();
    parts.push(sideGain);
    sideGain.gain.value = Math.max(0.35, 1 - 0.3 * side * bias) * 0.72;
    sideGain.connect(dest);
    scrapeG.connect(sideGain);

    const offset = (side * BEAT) / 2;
    for (const mode of SWOOSH_METAL_MODES) {
      const bp = actx.createBiquadFilter();
      const mg = actx.createGain();
      parts.push(bp, mg);
      bp.type = 'bandpass';
      bp.Q.value = mode.q;
      const f0 = baseStart * mode.ratio + offset;
      const f1 = baseMid * mode.ratio + offset;
      const f2 = baseEnd * mode.ratio + offset;
      bp.frequency.value = f0;
      bp.frequency.setValueAtTime(f0, now);
      bp.frequency.setValueAtTime(f0, t);
      rampFreq(bp.frequency, f1, t + dur * 0.4);
      rampFreq(bp.frequency, f2, t + dur);
      mg.gain.value = mode.amp;
      g.connect(bp);
      bp.connect(mg);
      mg.connect(sideGain);
    }

    // Binaural sub under the metal, so the throw still has weight.
    const sub = actx.createOscillator();
    const subGain = actx.createGain();
    parts.push(sub, subGain);
    sub.type = 'sine';
    const s0 = inKey(190) + offset, s1 = inKey(430) + offset, s2 = inKey(150) + offset;
    sub.frequency.value = s0;
    sub.frequency.setValueAtTime(s0, now);
    sub.frequency.setValueAtTime(s0, t);
    rampFreq(sub.frequency, s1, t + dur * 0.4);
    rampFreq(sub.frequency, s2, t + dur);
    subGain.gain.value = SILENCE;
    subGain.gain.setValueAtTime(SILENCE, now);
    subGain.gain.setValueAtTime(SILENCE, t);
    subGain.gain.linearRampToValueAtTime(peak * 0.42, t + 0.03);
    subGain.gain.linearRampToValueAtTime(SILENCE, t + dur);
    subGain.gain.linearRampToValueAtTime(0, t + dur + 0.04);
    sub.connect(subGain);
    subGain.connect(dest);
    sub.start(t);
    sub.stop(t + dur + 0.06);
  }

  // Metal rings into the room; the dry-only mono version never did.
  if (AudioStore.wetBus) g.connect(AudioStore.wetBus);

  const bufDur = AudioStore.noiseBuf!.duration || 2.0;
  src.start(t, Math.random() * Math.max(0, bufDur - 0.5));
  src.stop(t + dur + ring + 0.06);

  AudioStore.thuds++;
  src.onended = () => {
    AudioStore.thuds = Math.max(0, AudioStore.thuds - 1);
    for (const n of parts) { try { n.disconnect(); } catch (e) {} }
    parts.length = 0;
  };
}

// Launch swoosh. Ball-on-ball collisions are `playKnock`.
export function playSwoosh(xNorm: number, force: number, opts: SwooshOptions = {}) {
  const { ignoreOptionsGuard = false, isWhite = false } = opts;
  if (!voiceAllowed(ignoreOptionsGuard, { noise: true, vol: AudioStore.clickVol })) return;
  const actx = AudioStore.actx!;
  const now = actx.currentTime;
  if (AudioStore.thuds >= MAX_THUDS) return;

  const normForce = Math.min(1, Math.max(0, force));
  if (now - AudioStore.swooshAt < 0.08) return;
  AudioStore.swooshAt = now;

  // The white ball is a different instrument, not a brighter setting of this one.
  if (isWhite) { playWhiteSwoosh(xNorm, normForce); return; }

  // Tight 10ms lookahead for immediate audio response without JS frame-lag crackle
  const t = now + LOOKAHEAD.brief;
  const dur = 0.22;
  const peak = 0.22 * Math.max(0.15, normForce) * AudioStore.clickVol;
  if (peak < 0.001) return;

  const src = actx.createBufferSource();
  src.buffer = AudioStore.noiseBuf;
  src.loop = true;
  src.playbackRate.value = 0.85;

  // 1. Envelope Gain Node FIRST (initialized to SILENCE to prevent step discontinuities into filter)
  const g = actx.createGain();
  g.gain.value = SILENCE;
  g.gain.setValueAtTime(SILENCE, now);
  g.gain.setValueAtTime(SILENCE, t);
  g.gain.linearRampToValueAtTime(Math.max(SILENCE, peak), t + 0.04);
  g.gain.linearRampToValueAtTime(SILENCE, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.03);

  // 2. Lowpass Filter SECOND (receives zero-initialized gain output)
  const bp = actx.createBiquadFilter();
  bp.type = 'lowpass';
  bp.Q.value = 0.7;
  const startFreq = 350;
  bp.frequency.value = startFreq;
  bp.frequency.setValueAtTime(startFreq, now);
  bp.frequency.setValueAtTime(startFreq, t);
  rampFreq(bp.frequency, 1000, t + dur * 0.4);
  rampFreq(bp.frequency, 250, t + dur);

  // Connect: src -> g -> bp
  const parts: any[] = [src, g, bp];
  src.connect(g);
  g.connect(bp);

  // Smooth pitch-swept sine sub-oscillator
  const osc = actx.createOscillator();
  const oscGain = actx.createGain();
  parts.push(osc, oscGain);
  osc.type = 'sine';

  const startP = inKey(130);
  const midP = inKey(260);
  const endP = inKey(100);

  osc.frequency.value = startP;
  osc.frequency.setValueAtTime(startP, now);
  osc.frequency.setValueAtTime(startP, t);
  rampFreq(osc.frequency, midP, t + dur * 0.4);
  rampFreq(osc.frequency, endP, t + dur);

  oscGain.gain.value = SILENCE;
  oscGain.gain.setValueAtTime(SILENCE, now);
  oscGain.gain.setValueAtTime(SILENCE, t);
  oscGain.gain.linearRampToValueAtTime(peak * 0.45, t + 0.04);
  oscGain.gain.linearRampToValueAtTime(SILENCE, t + dur);
  oscGain.gain.linearRampToValueAtTime(0, t + dur + 0.03);

  osc.connect(oscGain);
  oscGain.connect(bp);
  osc.start(t);
  osc.stop(t + dur + 0.05);

  panned(bp, AudioStore.master!, Math.max(-1, Math.min(1, xNorm || 0)) * 0.7, undefined, parts);

  const bufDur = AudioStore.noiseBuf!.duration || 2.0;
  const offset = Math.random() * Math.max(0, bufDur - 0.5);
  src.start(t, offset);
  src.stop(t + dur + 0.05);

  AudioStore.thuds++;
  src.onended = () => {
    AudioStore.thuds = Math.max(0, AudioStore.thuds - 1);
    for (const n of parts) { try { n.disconnect(); } catch (e) {} }
    parts.length = 0;
  };
}

/**
 * The partials of a struck piano string, which is what a knock rings like since
 * 2026-09-19. It was a tuned wooden bar before — modes at ×1, ×3 and ×6 decaying
 * in 90 / 50 / 28 ms — and those odd, widely spaced ratios over a very short ring
 * are exactly what read as wood.
 *
 * Three things make this a piano instead, and each matters:
 * - **The harmonic series**, ×1 to ×5, rather than a bar's 1 : 3 : 6.
 * - **Stretched sharp.** A real string is stiff, so its partials run above exact
 *   multiples, by `n × sqrt(1 + B n²)` with B ≈ 4e-4 for a mid-range string. The
 *   stretch is small — 9 cents at the fifth partial — and it is most of what
 *   separates a piano from an organ.
 * - **The fundamental rings longest**, 0.16s against the third partial's 0.05s.
 *   The top of the sound decays away and leaves the note, which is the shape of
 *   a struck string.
 *
 * It rang 0.42s over five partials for a few hours on 2026-09-19 and was too
 * long: knocks are the most frequent voice in the game, and Tony asked for the
 * string without the tail. Three partials also keep the node count down, which
 * matters when ten knocks can overlap.
 */
export const KNOCK_MODES = [
  { ratio: 1.000, amp: 1.00, decay: 0.16 },
  { ratio: 2.002, amp: 0.45, decay: 0.09 },
  { ratio: 3.005, amp: 0.22, decay: 0.05 },
];

/**
 * The harmonics carrying the boom's pitch where a small speaker can reproduce it.
 * Levels are a fraction of the dive's own, and they ride above the low cut.
 */
export const BOOM_HARMONICS = [
  { ratio: 2, amp: 0.34 },
  { ratio: 3, amp: 0.18 },
];

/** The longest a knock rings: its fundamental. */
export const KNOCK_RING = Math.max(...KNOCK_MODES.map(m => m.decay));

// A ball's knock note: its colour's bond-lock scale degree, one octave up, so
// collisions play in key with the locks and the drone.
function knockPitch(rel: number): number {
  return SCALE_NOTES[scaleDegree(rel)] * BOND_VOICE.mul * 2;
}

function knockEnvelope(param: AudioParam, peak: number, now: number, t: number, attack: number, decay: number) {
  param.value = SILENCE;
  param.setValueAtTime(SILENCE, now);
  param.setValueAtTime(SILENCE, t);
  param.linearRampToValueAtTime(Math.max(SILENCE, peak), t + attack);
  param.exponentialRampToValueAtTime(SILENCE, t + attack + decay);
  param.linearRampToValueAtTime(0, t + attack + decay + 0.01);
}

/**
 * Ball-on-ball knock between two unbonded balls: a hammer thump over a struck
 * piano string. Each ball rings its own colour's note (`rel` as for `playNote`),
 * so a collision is a two-note chord, the struck ball answering just after the
 * hitter. Harder hits are brighter, not higher, to stay in key.
 */
export function playKnock(xNorm: number, force: number, relHitter: number, relStruck: number, opts: { ignoreOptionsGuard?: boolean } = {}) {
  const { ignoreOptionsGuard = false } = opts;
  if (!voiceAllowed(ignoreOptionsGuard, { noise: true, vol: AudioStore.clickVol })) return;
  if (AudioStore.thuds >= MAX_THUDS) return;
  const normForce = Math.min(1, Math.max(0, force));
  if (normForce < 0.03) return;
  const actx = AudioStore.actx!;
  const now = actx.currentTime;
  if (now - AudioStore.thudAt < 0.035) return;
  AudioStore.thudAt = now;

  // Sits well under the bond lock at equal sliders (the hardest knock ~8 dB below
  // a mid-scale lock), since its strike reads louder than the measured gap. The
  // two sides of each binaural pair carry 0.7 each, so a pair holds about the
  // energy one oscillator used to.
  const peak = 0.08 * Math.max(0.15, normForce) * AudioStore.clickVol;
  if (peak < 0.001) return;
  // Tight 10ms lookahead for immediate audio response without JS frame-lag crackle
  const t = now + LOOKAHEAD.brief;
  const bright = 0.55 + 0.45 * normForce;
  const hitterF = knockPitch(relHitter);
  const struckF = knockPitch(relStruck);
  // Two notes at 0.7 each carry the same energy as one note at full level.
  const notes = hitterF === struckF
    ? [{ f: hitterF, at: t, amp: 1 }]
    : [{ f: hitterF, at: t, amp: 0.7 }, { f: struckF, at: t + 0.018, amp: 0.7 }];
  const end = t + 0.018 + KNOCK_RING + 0.03;

  const parts: any[] = [];
  const master: AudioNode = AudioStore.master!;
  const bias = Math.max(-1, Math.min(1, xNorm || 0));
  // Binaural, like the drone, the boom and the white swoosh: each partial is a
  // pair `BEAT` Hz apart, one ear each, so the knock has width of its own rather
  // than being a mono sound placed left or right. Where on the table it happened
  // biases the two sides instead of collapsing them.
  const sides = [-1, 1].map(side =>
    panInto(master, Math.max(-1, Math.min(1, side * 0.8 + bias * 0.2)), parts));
  const centre = panInto(master, bias * 0.7, parts);

  for (const note of notes) {
    KNOCK_MODES.forEach((m, i) => {
      sides.forEach((dest, s) => {
        const osc = actx.createOscillator();
        const g = actx.createGain();
        parts.push(osc, g);
        osc.type = 'sine';
        const f = note.f * m.ratio + (s === 0 ? -BEAT / 2 : BEAT / 2);
        osc.frequency.value = f;
        osc.frequency.setValueAtTime(f, now);
        knockEnvelope(g.gain, peak * note.amp * m.amp * (i ? bright : 1) * 0.7, now, note.at, 0.003, m.decay);
        osc.connect(g);
        g.connect(dest);
        osc.start(note.at);
        osc.stop(end);
      });
    });
  }

  // The hammer: a soft thump of band-passed noise rather than the bright contact
  // click a wooden bar makes. On a piano the hammer is felt more than heard.
  const src = actx.createBufferSource();
  src.buffer = AudioStore.noiseBuf;
  src.loop = true;
  src.playbackRate.value = 1.4;
  const cg = actx.createGain();
  knockEnvelope(cg.gain, peak * 1.3 * bright, now, t, 0.0012, 0.022);
  const bp = actx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.7;
  const clickFreq = Math.min(3600, Math.max(hitterF, struckF) * 2.0);
  bp.frequency.value = clickFreq;
  bp.frequency.setValueAtTime(clickFreq, now);
  parts.push(src, cg, bp);
  src.connect(cg);
  cg.connect(bp);
  bp.connect(centre);

  const bufDur = AudioStore.noiseBuf?.duration || 2.0;
  src.start(t, Math.random() * Math.max(0, bufDur - 0.5));
  src.stop(end);

  AudioStore.thuds++;
  src.onended = () => {
    AudioStore.thuds = Math.max(0, AudioStore.thuds - 1);
    for (const n of parts) { try { n.disconnect(); } catch (e) {} }
    parts.length = 0;
  };
}

