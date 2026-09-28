import { describe, it, expect, beforeEach } from 'vitest';
import { aiAim } from '../../src/game/AI';
import { makeLauncher } from '../../src/game/GameState';
import { makeGroup } from '../../src/physics/RigidBody';
import { Ball } from '../../src/physics/Types';
import { recalcThresholds } from '../../src/physics/Config';

function createMockBall(id: number, x: number, y: number, kind: number = 0): Ball {
  return {
    id,
    x,
    y,
    kind,
    special: null,
    color: '#E6194B',
    credit: 0,
    bonds: new Set(),
    group: null as any,
  };
}

describe('AI module', () => {
  beforeEach(() => {
    recalcThresholds(620);
  });

  it('aims toward the largest group of balls when a group of 2+ exists', () => {
    const aiPlayer = makeLauncher(-1); // Top launcher at (400, 38)
    const b1 = createMockBall(1, 200, 300);
    const b2 = createMockBall(2, 215, 300);
    const g = makeGroup([b1, b2], 0, 0);

    aiAim(aiPlayer, [g], [b1, b2], 800, 600, false);

    // AI should rotate launcher angle toward (207.5, 300)
    expect(aiPlayer.aimDeg).not.toBe(0);
    expect(aiPlayer.strength).toBeGreaterThan(0);
  });

  it('falls back to nearest single ball when no multi-ball group exists', () => {
    const aiPlayer = makeLauncher(-1); // Top launcher at (400, 38)
    const b1 = createMockBall(1, 500, 200);
    const g = makeGroup([b1], 0, 0);

    aiAim(aiPlayer, [g], [b1], 800, 600, false);

    expect(aiPlayer.aimDeg).not.toBe(0);
    expect(aiPlayer.strength).toBeGreaterThan(0);
  });

  it('uses idle wander angle when court is empty', () => {
    const aiPlayer = makeLauncher(-1);
    aiAim(aiPlayer, [], [], 800, 600, false);

    expect(aiPlayer._idleDeg).toBeDefined();
    expect(aiPlayer.strength).toBeGreaterThan(0);
  });

  it('assigns target strength when aiming at a group', () => {
    const aiPlayer = makeLauncher(-1);
    const b1 = createMockBall(1, 200, 300);
    const b2 = createMockBall(2, 215, 300);
    const g = makeGroup([b1, b2], 0, 0);

    aiAim(aiPlayer, [g], [b1, b2], 800, 600, false);

    expect((aiPlayer as any)._targetStrength).toBeGreaterThanOrEqual(0.35);
    expect((aiPlayer as any)._targetStrength).toBeLessThanOrEqual(1.0);
  });
});

import { AI_LEVELS, AI_STRATEGIES, CLASSIC_LEVEL, ladderStep, launchSpeedToArrive, profileNamed, strengthForSpeed } from '../../src/game/AI';
import { launchSpeedOf } from '../../src/physics/LauncherBays';
import { PhysicsConfig } from '../../src/physics/Config';

describe('the AI ladder', () => {
  it('has the four rungs that were proven apart, AGI on top', () => {
    expect(AI_LEVELS.map(l => l.label)).toEqual(['AI1', 'AI2', 'AI3', 'AGI']);
    // The pre-ladder AI is not a rung; it is what plays when no rung is set.
    expect(AI_LEVELS.some(l => l.classic)).toBe(false);
    expect(CLASSIC_LEVEL).toBe(-1);
    expect(profileNamed('engine-ai')).toBe(AI_STRATEGIES.current);
    expect(profileNamed('ai3')?.power).toBe('max');
    expect(profileNamed('agi')?.plan).toBeTruthy();
  });

  it('moves up on a win, down on a loss, nowhere on a draw, and holds at both ends', () => {
    const top = AI_LEVELS.length - 1;
    expect(ladderStep(1, 500, 400)).toBe(2);
    expect(ladderStep(2, 400, 500)).toBe(1);
    expect(ladderStep(2, 450, 450)).toBe(2);
    expect(ladderStep(0, 100, 900)).toBe(0);
    expect(ladderStep(top, 900, 100)).toBe(top);
  });

  it('throws exactly as hard as it means to', () => {
    recalcThresholds(620);
    for (const s of [0.2, 0.5, 0.85, 1]) {
      const speed = launchSpeedOf({ strength: s } as any);
      expect(strengthForSpeed(speed)).toBeCloseTo(s, 6);
    }
    // Rolling costs speed in proportion to distance: 0 px costs nothing.
    expect(launchSpeedToArrive(PhysicsConfig.BOOM_SPEED, 0)).toBe(PhysicsConfig.BOOM_SPEED);
    expect(launchSpeedToArrive(PhysicsConfig.BOOM_SPEED, 300)).toBeGreaterThan(PhysicsConfig.BOOM_SPEED);
  });
});
