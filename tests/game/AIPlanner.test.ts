import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGame, resetField, startMatch } from '../../src/game/GameState';
import { recalcThresholds } from '../../src/physics/Config';
import { withSeed } from '../../src/sim/Rng';
import { AudioStore } from '../../src/audio/SynthEngine';
import { PlanJob, cloneForPlanning, setPlannerBudget, PLAN_FRAMES_PER_FRAME } from '../../src/game/AIPlanner';

const W = 380, H = 620;

function table() {
  recalcThresholds(H);
  const game = createGame();
  game.twoPlayer = true;
  resetField(game, W, H);
  startMatch(game, 0);
  return game;
}

const CANDIDATES = [-40, -15, 0, 20, 45].map(aimDeg => ({ aimDeg, strength: 1 }));

beforeEach(() => setPlannerBudget(Infinity));
afterEach(() => setPlannerBudget(PLAN_FRAMES_PER_FRAME));

describe('the planner', () => {
  AudioStore.soundOn = false;

  it('leaves the real table exactly as it found it', () => {
    withSeed(3, () => {
      const game = table();
      const before = JSON.stringify(game.balls.map(b => [b.id, b.x, b.y, [...b.bonds], b.group.vx, b.group.vy]));
      const scores = game.players.map(p => p.score);
      const job = new PlanJob(game, 1, CANDIDATES, 1.2, 0.5, W, H, 42);
      job.run();
      expect(job.done).toBe(true);
      expect(JSON.stringify(game.balls.map(b => [b.id, b.x, b.y, [...b.bonds], b.group.vx, b.group.vy]))).toBe(before);
      expect(game.players.map(p => p.score)).toEqual(scores);
    });
  });

  it('draws nothing from the shared random numbers', () => {
    const next = (plan: boolean) => withSeed(5, () => {
      const game = table();
      if (plan) new PlanJob(game, 1, CANDIDATES, 1.2, 0.5, W, H, 42).run();
      return Math.random();
    });
    expect(next(true)).toBe(next(false));
  });

  it('comes to the same decision whether it thinks all at once or a little each frame', () => {
    const decide = (budget: number) => withSeed(7, () => {
      setPlannerBudget(budget);
      const job = new PlanJob(table(), 1, CANDIDATES, 1.2, 0.5, W, H, 42);
      let frames = 0;
      while (!job.done && frames < 10000) { job.run(); frames++; }
      return { best: job.best, frames };
    });
    const whole = decide(Infinity);
    const sliced = decide(0);
    expect(whole.frames).toBe(1);
    expect(sliced.frames).toBeGreaterThan(1);
    expect(sliced.best).toEqual(whole.best);
  });

  it('copies deeply enough that the copy can be played on', () => {
    withSeed(9, () => {
      const game = table();
      const copy = cloneForPlanning(game);
      copy.balls[0].x += 50;
      copy.balls[0].bonds.add(999);
      copy.players[0].score = 12345;
      expect(game.balls[0].x).not.toBe(copy.balls[0].x);
      expect(game.balls[0].bonds.has(999)).toBe(false);
      expect(game.players[0].score).toBe(0);
      for (const b of copy.balls) expect(copy.groups).toContain(b.group);
    });
  });
});
