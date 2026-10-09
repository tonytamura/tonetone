import { Game } from '../game/GameState';
import { againstAgi } from '../game/AI';
import { MessageKey, tList } from '../i18n/I18n';
import { ageEffects } from '../physics/CollisionSolver';
import { PhysicsConfig } from '../physics/Config';
import { panOf } from '../audio/SoundEvents';
import { AudioStore, isOptionsOpen, triggerHaptic } from '../audio/SynthEngine';
import { playNote, playSwoosh, playRandomGameBoom } from '../audio/Voices';
import { playFlashSound } from '../audio/FlashSounds';

/**
 * The fireworks over the results card: flashes, floating words and booms, on
 * independent cadences, confined to the winner's half of the screen.
 *
 * Solo has none: it is the relaxed mode, and its results are a score, not a
 * win. Beating AGI, the top of the ladder, has the biggest: the whole screen,
 * everything faster and denser, a 9-ball boom to open and rising runs of notes.
 *
 * Each cadence keeps the wall-clock time it last fired. That state used to sit
 * in `main.ts` alongside nine other jobs; it belongs to the celebration and
 * nothing else reads it.
 */

let lastFlashTime = 0;
let lastPopTime = 0;
let lastBoomTime = 0;
let lastNoteTime = 0;
let lastBigBoomTime = 0;
let noteStep = 0;
let openingDue = false;

/** How hard a celebration goes: the usual one, or the one for beating AGI. */
interface Intensity {
  flashCap: number; flashGap: [number, number]; flashesPerBurst: number;
  popCap: number; popGap: [number, number]; popScale: number;
  /** The words it floats, a list in the player's language. */
  words: MessageKey;
  boomGap: [number, number];
  /** Rising notes and the periodic big boom: only the AGI ending has them. */
  noteGap: [number, number] | null; bigBoomGap: [number, number] | null;
}

// Keep the words short — a pop is drawn centred, and a long one does not fit
// a phone's width at the AGI ending's size.
const USUAL: Intensity = {
  flashCap: 5, flashGap: [850, 2150], flashesPerBurst: 1,
  popCap: 4, popGap: [1200, 2800], popScale: 1,
  words: 'res.pops',
  boomGap: [500, 1400],
  noteGap: null, bigBoomGap: null,
};

export const BEAT_AGI: Intensity = {
  flashCap: 18, flashGap: [120, 400], flashesPerBurst: 2,
  popCap: 9, popGap: [220, 500], popScale: 1.5,
  words: 'res.agiPops',
  boomGap: [220, 520],
  noteGap: [110, 260], bigBoomGap: [2400, 4000],
};

const gap = ([lo, hi]: [number, number]) => lo + Math.random() * (hi - lo);

/** Called when a match ends: the next results frame is the celebration's first. */
export function startResultsEffects() {
  openingDue = true;
  noteStep = 0;
}

/** Did the player just beat AGI? A draw is not a win here. */
export function beatAgi(game: Game): boolean {
  return againstAgi(game) && (game.players[0]?.score || 0) > (game.players[1]?.score || 0);
}

/**
 * Which player the results celebration belongs to, or -1 for nobody.
 *
 * A draw celebrates nobody, as both results cards say "Draw" (it used to credit
 * player 1 with fireworks and "WINNER!"). The AI is player 2 and never gets a
 * celebration: losing to it is not an occasion for fireworks, so when it wins
 * nothing new is spawned. Solo gets none either.
 */
export function celebrationWinner(game: Game): number {
  if (!game.twoPlayer) return -1;
  const p0 = game.players[0]?.score || 0;
  const p1 = game.players[1]?.score || 0;
  if (p0 === p1) return -1;
  const winnerIdx = p0 > p1 ? 0 : 1;
  if (game.aiOn && winnerIdx === 1) return -1;
  return winnerIdx;
}

/**
 * Vertical band the celebration is allowed to occupy, in screen pixels.
 *
 * Split-screen gives player 1 the bottom half and player 2 the top half (their
 * card is the flipped one), so the celebration stays on the winner's side of
 * the midline instead of spilling onto the loser's board. Beating AGI owns the
 * whole screen.
 */
function celebrationBand(game: Game, winnerIdx: number, H: number): { top: number; bottom: number } {
  if (beatAgi(game)) return { top: 0, bottom: H };
  return winnerIdx === 0 ? { top: H * 0.5, bottom: H } : { top: 0, bottom: H * 0.5 };
}

/** Pick a coordinate inside [lo, hi], falling back to its centre when inverted. */
function randBetween(lo: number, hi: number): number {
  return hi > lo ? lo + Math.random() * (hi - lo) : (lo + hi) / 2;
}

export function updateResultsEffects(game: Game, dt: number, W: number, H: number) {
  const now = performance.now();

  // 1. Age what is on screen. Celebration pops drift away from their player as
  //    they fade: up the screen for player 1, down it for player 2, whose card
  //    is the flipped one. The rest of the lifecycle is the solver's.
  for (const pop of game.pops) pop.y += (pop.who === 1 ? 1 : -1) * dt * 30;
  ageEffects(game, dt);

  const winnerIdx = celebrationWinner(game);
  if (winnerIdx < 0) return; // solo, or the AI won — let whatever is on screen fade and spawn nothing

  const band = celebrationBand(game, winnerIdx, H);
  const epic = beatAgi(game);
  const cfg = epic ? BEAT_AGI : USUAL;
  const audible = AudioStore.soundOn && !isOptionsOpen();

  // The AGI ending opens all at once: a ring of flashes, the biggest boom there is.
  if (openingDue) {
    openingDue = false;
    if (epic) {
      for (let i = 0; i < 8; i++) spawnFlash(game, W, band);
      if (audible) playNote(0.5, 0, 'boom', { boomSize: 9 });
      if (!isOptionsOpen()) triggerHaptic('heavy');
      lastFlashTime = lastBigBoomTime = now;
    }
  }

  // 2. Spawn randomized celebratory flashes
  if (game.flashes.length < cfg.flashCap && now - lastFlashTime > gap(cfg.flashGap)) {
    lastFlashTime = now;
    for (let i = 0; i < cfg.flashesPerBurst; i++) {
      const f = spawnFlash(game, W, band);
      if (audible) {
        const normX = panOf(f.x, W);
        playFlashSound(f.kind, normX, 'celebration');
      }
    }
  }

  // Booms on their own cadence, faster than the flashes and independent of them.
  // Tying every boom to a flash capped them at the flash rate and at the half of
  // the flash kinds that map to a boom, which is too sparse for a victory lap.
  if (audible && now - lastBoomTime > gap(cfg.boomGap)) {
    lastBoomTime = now;
    playRandomGameBoom(Math.random() * 1.6 - 0.8, 'celebration');
  }

  // Beating AGI: runs of notes climbing the scale, over and over, and every few
  // seconds another big boom you can feel.
  if (cfg.noteGap && audible && now - lastNoteTime > gap(cfg.noteGap)) {
    lastNoteTime = now;
    playNote((noteStep++ % 12) / 11, Math.random() * 1.6 - 0.8, 'bond', { boost: 0.6 });
  }
  if (cfg.bigBoomGap && now - lastBigBoomTime > gap(cfg.bigBoomGap)) {
    lastBigBoomTime = now;
    if (audible) playNote(Math.random(), Math.random() * 1.6 - 0.8, 'boom', { boomSize: 6 + Math.floor(Math.random() * 4) });
    // Felt even with the sound off (haptics has its own switch), but not under Options.
    if (!isOptionsOpen()) triggerHaptic('heavy');
  }

  // 3. Spawn randomized celebratory pops
  if (game.pops.length < cfg.popCap && now - lastPopTime > gap(cfg.popGap)) {
    lastPopTime = now;
    // Congratulations only. This list used to mix in the in-match event labels
    // (BOND, BOOM, LOCK, PEEL) and invented score pops (+1000, +5000), which
    // read as though something were still being scored on a board that has
    // stopped.
    const words = tList(cfg.words);
    const txt = words[Math.floor(Math.random() * words.length)];
    // A pop travels about 70px over its life, towards the far edge of its
    // player's half: up for player 1, down for player 2. Leave that room.
    const pad = 28;
    const ry = winnerIdx === 1
      ? randBetween(band.top + pad, band.bottom - 70)
      : randBetween(band.top + 70, band.bottom - pad);
    const rx = randBetween(W * 0.15, W * 0.85);
    game.pops.push({ x: rx, y: ry, t: 0, label: { text: txt }, who: winnerIdx, scale: cfg.popScale });

    if (audible && Math.random() < 0.4) {
      const normX = panOf(rx, W);
      playSwoosh(normX, 0.4);
    }
  }
}

function spawnFlash(game: Game, W: number, band: { top: number; bottom: number }) {
  const kinds: ('bond' | 'break' | 'spawn' | 'blocked')[] = ['bond', 'break', 'spawn', 'blocked'];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  // A ring grows to about R*5 before it fades, so inset the spawn by that much
  // to keep the whole ring inside the winner's band.
  const ringReach = PhysicsConfig.R * 5.5;
  const x = randBetween(Math.max(W * 0.12, ringReach), Math.min(W * 0.88, W - ringReach));
  const y = randBetween(band.top + ringReach, band.bottom - ringReach);
  const f = { x, y, t: 0, kind };
  game.flashes.push(f);
  return f;
}
