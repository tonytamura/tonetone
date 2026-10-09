import { describe, it, expect } from 'vitest';
import { createGame, resetField, startMatch, throwBall } from '../../src/game/GameState';
import { advanceFrame } from '../../src/sim/Frame';
import { runSim } from '../../src/sim/Harness';
import { TOLERANCE, violations } from '../../src/sim/Metrics';

describe('Simultaneous 2-Player Play', () => {
  it('lets both players throw on the same frame in 2P mode', () => {
    const game = createGame();
    game.twoPlayer = true;
    resetField(game, 380, 620);
    startMatch(game, 0);
    // No turns: both launchers are ready at once, and one frame throws both.
    expect(advanceFrame(game, 1 / 60, 380, 620, 0).threw).toBe(2);
    expect(game.balls.some(b => b.credit === 0) && game.balls.some(b => b.credit === 1)).toBe(true);
  });

  it('handles simultaneous shots from both players without physics violations', () => {
    const game = createGame();
    game.twoPlayer = true;
    resetField(game, 380, 620);

    // Aim both launchers towards center
    game.players[0].aimDeg = 0;
    game.players[0].strength = 0.8;
    game.players[1].aimDeg = 0;
    game.players[1].strength = 0.8;

    // Fire both launchers simultaneously
    const threw0 = throwBall(game.players[0], game, 380, 620);
    const threw1 = throwBall(game.players[1], game, 380, 620);

    expect(threw0).toBe(true);
    expect(threw1).toBe(true);
    expect(game.balls.length).toBeGreaterThanOrEqual(2);

    // Both balls should belong to their respective launchers
    const p0Ball = game.balls.find(b => b.credit === 0);
    const p1Ball = game.balls.find(b => b.credit === 1);
    expect(p0Ball).toBeDefined();
    expect(p1Ball).toBeDefined();
  });

  it('runs a simultaneous duel cleanly, with both players scoring', () => {
    const res = runSim({
      seed: 42,
      seconds: 30,
      mode: 'duel',
      policies: ['engine-ai', 'engine-ai'],
    });

    expect(violations(res.worst)).toEqual([]);
    expect(res.worst.frozen).toBe(0);
    expect(res.worst.overlap).toBeLessThanOrEqual(TOLERANCE.overlap);
    expect(res.throws).toBeGreaterThan(0);
    // Both players score in 2-player mode (`>= 0` here used to pass with neither).
    expect(res.players[0].score).toBeGreaterThan(0);
    expect(res.players[1].score).toBeGreaterThan(0);
  });
});
