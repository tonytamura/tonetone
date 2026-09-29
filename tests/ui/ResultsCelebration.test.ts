import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createGame } from '../../src/game/GameState';
import { AI_LEVELS, CLASSIC_LEVEL } from '../../src/game/AI';
import { AudioStore } from '../../src/audio/SynthEngine';
import { BEAT_AGI, beatAgi, celebrationWinner, startResultsEffects, updateResultsEffects } from '../../src/ui/ResultsCelebration';

const W = 390, H = 844;
const AGI = AI_LEVELS.length - 1;
/** Wall clock for the cadences; like `performance.now`, it only goes forwards. */
let clock = 1e6;

/** A finished match, and the results screen run for `seconds` of wall clock. */
function results(setup: (g: ReturnType<typeof createGame>) => void, seconds = 6) {
  const game = createGame();
  game.matchOver = true;
  setup(game);
  startResultsEffects();
  let flashes = 0, pops = 0, peakFlashes = 0;
  const seen = new Set<object>();
  clock += 60_000; // well past every cadence's last firing, whatever an earlier test left
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
  for (let i = 0; i < seconds * 60; i++) {
    clock += 1000 / 60;
    updateResultsEffects(game, 1 / 60, W, H);
    for (const f of game.flashes) if (!seen.has(f)) { seen.add(f); flashes++; }
    for (const p of game.pops) if (!seen.has(p)) { seen.add(p); pops++; }
    peakFlashes = Math.max(peakFlashes, game.flashes.length);
  }
  spy.mockRestore();
  return { game, flashes, pops, peakFlashes };
}

const vsAi = (level: number, mine: number, theirs: number) => (g: ReturnType<typeof createGame>) => {
  g.twoPlayer = true; g.aiOn = true; g.aiLevel = level;
  g.players[0].score = mine; g.players[1].score = theirs;
};

describe('results celebration', () => {
  let sound: boolean, haptics: boolean;
  beforeEach(() => { sound = AudioStore.soundOn; haptics = AudioStore.haptics; AudioStore.soundOn = false; AudioStore.haptics = false; });
  afterEach(() => { AudioStore.soundOn = sound; AudioStore.haptics = haptics; });

  it('celebrates nothing in solo: it is the relaxed mode', () => {
    const r = results(g => { g.twoPlayer = false; g.aiOn = false; g.players[0].score = 5000; });
    expect(celebrationWinner(r.game)).toBe(-1);
    expect(r.flashes + r.pops).toBe(0);
  });

  it('celebrates nothing when the AI wins, AGI included', () => {
    const r = results(vsAi(AGI, 100, 900));
    expect(r.flashes + r.pops).toBe(0);
  });

  it('celebrates a win against a lower rung the usual way', () => {
    const r = results(vsAi(0, 900, 100));
    expect(beatAgi(r.game)).toBe(false);
    expect(r.flashes).toBeGreaterThan(0);
    expect(r.pops).toBeGreaterThan(0);
    expect(r.peakFlashes).toBeLessThanOrEqual(5);
    expect(r.game.pops.every(p => (p.scale ?? 1) === 1)).toBe(true);
  });

  it('goes biggest when the player beats AGI: more of everything, bigger words, the whole screen', () => {
    const usual = results(vsAi(0, 900, 100));
    const epic = results(vsAi(AGI, 900, 100));
    expect(beatAgi(epic.game)).toBe(true);
    expect(epic.flashes).toBeGreaterThan(usual.flashes * 3);
    expect(epic.pops).toBeGreaterThan(usual.pops * 2);
    expect(epic.peakFlashes).toBeGreaterThan(5);
    expect(epic.game.pops.every(p => p.scale === BEAT_AGI.popScale)).toBe(true);
    // Not confined to player 1's half, as the usual celebration is.
    expect(epic.game.flashes.concat().some(f => f.y < H / 2) || epic.game.pops.some(p => p.y < H / 2)).toBe(true);
  });

  it('does not count a draw with AGI as beating it', () => {
    const r = results(vsAi(AGI, 500, 500));
    expect(beatAgi(r.game)).toBe(false);
  });

  it('plays the classic AI, which is no rung, as the usual celebration', () => {
    const r = results(vsAi(CLASSIC_LEVEL, 900, 100));
    expect(beatAgi(r.game)).toBe(false);
  });
});
