import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGame, resetField, startMatch, Game } from '../../src/game/GameState';
import { advanceFrame, FALLBACK_DT } from '../../src/sim/Frame';
import { BANK_MAX, BOT_RELEASE_GAP, setFireOnRelease } from '../../src/game/Rules';
import { snapshotConfig, restoreConfig, ConfigSnapshot } from '../../src/sim/Knobs';
import { runSim } from '../../src/sim/Harness';
import { AI_LEVELS, levelIndex } from '../../src/game/AI';
import { AudioStore } from '../../src/audio/SynthEngine';

/**
 * Continuous fire (the `fire` option): a launcher throws on every release of the
 * finger, as fast as the player taps, from a bank of up to three balls that the
 * reload ring refills one at a time. Tony, 2026-09-30.
 */
const W = 380, H = 620;
let saved: ConfigSnapshot;
let soundWas: boolean;

beforeEach(() => { saved = snapshotConfig(); soundWas = AudioStore.soundOn; AudioStore.soundOn = false; });
afterEach(() => { restoreConfig(saved); AudioStore.soundOn = soundWas; });

function solo(countdown = 0): Game {
  setFireOnRelease(true);
  const game = createGame();
  game.matchLen = 0;
  resetField(game, W, H);
  startMatch(game, countdown);
  return game;
}
/** Frames until `seconds` have passed; returns balls thrown. */
function run(game: Game, seconds: number): number {
  let threw = 0, clock = 0;
  for (let t = 0; t < seconds; t += FALLBACK_DT) {
    const r = advanceFrame(game, FALLBACK_DT, W, H, clock);
    clock = r.clock; threw += r.threw;
  }
  return threw;
}

describe('continuous fire', () => {
  it('starts with a full bank and throws a burst of releases at once, up to the bank', () => {
    const game = solo();
    const p = game.players[0];
    expect(p.bank).toBe(BANK_MAX);
    p.releases = 5; // five quick taps, faster than a frame
    expect(run(game, FALLBACK_DT)).toBe(BANK_MAX);
    expect(p.bank).toBe(0);
    expect(p.releases).toBe(0); // the taps past the bank are spent, not saved
  });

  it('never throws by itself: without a release, the bank just waits', () => {
    const game = solo();
    expect(run(game, 5)).toBe(0);
    expect(game.players[0].bank).toBe(BANK_MAX);
  });

  it('refills one ball per ring, and the ring rests when the bank is full', () => {
    const game = solo();
    const p = game.players[0];
    p.releases = 3;
    run(game, FALLBACK_DT);
    expect(p.bank).toBe(0);
    run(game, game.reloadTime + 0.05);
    expect(p.bank).toBe(1);
    run(game, game.reloadTime);
    expect(p.bank).toBe(2);
    run(game, game.reloadTime * 2);
    expect(p.bank).toBe(BANK_MAX);
    expect(p.reload).toBe(0);
  });

  it('holds every throw until the start countdown is over', () => {
    const game = solo(2);
    const p = game.players[0];
    p.releases = 1;
    expect(run(game, 1)).toBe(0);
    p.releases = 1;
    run(game, 1.1);
    p.releases = 1;
    expect(run(game, FALLBACK_DT)).toBe(1);
  });

  it('leaves the automatic launcher as it was when off', () => {
    setFireOnRelease(false);
    const game = createGame();
    game.matchLen = 0;
    resetField(game, W, H);
    startMatch(game, 0);
    game.players[0].releases = 3; // a release means nothing here
    expect(run(game, FALLBACK_DT)).toBe(1);
    expect(run(game, game.reloadTime + 0.05)).toBe(1);
  });

  it('lets the harness players release by themselves, never faster than a quick tap', () => {
    const at: number[][] = [[], []];
    runSim({
      mode: 'duel', seconds: 30, invariants: false, knobs: { fire: 1 },
      onFrame: g => g.players.forEach((p, i) => {
        if (p.lastThrowAt !== at[i][at[i].length - 1] && Number.isFinite(p.lastThrowAt)) at[i].push(p.lastThrowAt);
      }),
    });
    for (const times of at) {
      expect(times.length).toBeGreaterThan(8);
      for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(BOT_RELEASE_GAP - 1e-9);
    }
  });

  it('lets every AI rung play it, the planning one included', () => {
    for (const id of AI_LEVELS.map(l => l.id)) {
      const r = runSim({ mode: 'ai', aiLevel: levelIndex(id), seconds: 20, invariants: false, knobs: { fire: 1 } });
      expect(r.throws, id).toBeGreaterThan(4);
    }
  });
});
