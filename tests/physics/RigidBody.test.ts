import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeGroup,
  syncGroup,
  shiftGroup,
  rebuildGroups,
  separateGroups,
} from '../../src/physics/RigidBody';
import { Ball } from '../../src/physics/Types';
import { PhysicsConfig, recalcThresholds } from '../../src/physics/Config';

function createMockBall(id: number, x: number, y: number, kind: number = 0): Ball {
  return {
    id,
    x,
    y,
    kind,
    special: null,
    color: '#E6194B',
    credit: -1,
    bonds: new Set(),
    group: null as any,
  };
}

describe('RigidBody physics module', () => {
  beforeEach(() => {
    recalcThresholds(620);
  });

  describe('makeGroup', () => {
    it('calculates center of mass, offsets, total mass, and inertia correctly', () => {
      const b1 = createMockBall(1, 0, 0);
      const b2 = createMockBall(2, 20, 0);
      const members = [b1, b2];

      const g = makeGroup(members, 10, -5);
      expect(g.com.x).toBe(10);
      expect(g.com.y).toBe(0);
      expect(g.mass).toBe(2);
      expect(g.vx).toBe(10);
      expect(g.vy).toBe(-5);

      expect(g.offsets).toEqual([
        { x: -10, y: 0 },
        { x: 10, y: 0 },
      ]);

      // Inertia: sum of (ox^2 + oy^2 + R^2/2)
      // For b1: (-10)^2 + 0 + 144/2 = 100 + 72 = 172
      // For b2: 10^2 + 0 + 144/2 = 172
      // Total = 344
      expect(g.inertia).toBe(344);
    });
  });

  describe('syncGroup', () => {
    it('recalculates member ball positions after angular rotation', () => {
      const b1 = createMockBall(1, 0, 0);
      const b2 = createMockBall(2, 20, 0);
      const g = makeGroup([b1, b2], 0, 0);

      // Rotate group 90 degrees (Math.PI / 2)
      g.ang = Math.PI / 2;
      syncGroup(g);

      // com = (10, 0). offset b1 = (-10, 0), offset b2 = (10, 0)
      // cos(90) = 0, sin(90) = 1
      // b1.x = 10 + (-10)*0 - 0*1 = 10
      // b1.y = 0 + (-10)*1 + 0*0 = -10
      expect(b1.x).toBeCloseTo(10);
      expect(b1.y).toBeCloseTo(-10);

      expect(b2.x).toBeCloseTo(10);
      expect(b2.y).toBeCloseTo(10);
    });
  });

  describe('shiftGroup', () => {
    it('translates center of mass and all member balls', () => {
      const b1 = createMockBall(1, 10, 20);
      const b2 = createMockBall(2, 30, 40);
      const g = makeGroup([b1, b2], 0, 0);

      shiftGroup(g, 5, -10);

      expect(g.com.x).toBe(25);
      expect(g.com.y).toBe(20);
      expect(b1.x).toBe(15);
      expect(b1.y).toBe(10);
      expect(b2.x).toBe(35);
      expect(b2.y).toBe(30);
    });
  });

  describe('rebuildGroups', () => {
    it('groups unbonded balls into individual single-member groups', () => {
      const b1 = createMockBall(1, 100, 100);
      const b2 = createMockBall(2, 200, 200);
      const balls = [b1, b2];
      const byId = new Map([[1, b1], [2, b2]]);

      const groups = rebuildGroups(balls, byId);
      expect(groups.length).toBe(2);
      expect(groups[0].members).toEqual([b1]);
      expect(groups[1].members).toEqual([b2]);
    });

    it('combines bonded balls into connected component groups', () => {
      const b1 = createMockBall(1, 100, 100, 0);
      const b2 = createMockBall(2, 120, 100, 0);
      b1.bonds.add(2);
      b2.bonds.add(1);

      const balls = [b1, b2];
      const byId = new Map([[1, b1], [2, b2]]);

      const groups = rebuildGroups(balls, byId);
      expect(groups.length).toBe(1);
      expect(groups[0].members.length).toBe(2);
      expect(b1.group).toBe(groups[0]);
      expect(b2.group).toBe(groups[0]);
    });
  });

  describe('separateGroups', () => {
    it('resolves overlap between two groups along normal vector', () => {
      const b1 = createMockBall(1, 100, 100);
      const b2 = createMockBall(2, 115, 100); // distance = 15 < 2*R + 0.05 = 24.05
      const g1 = makeGroup([b1], 0, 0);
      const g2 = makeGroup([b2], 0, 0);

      const separated = separateGroups(g1, g2, 1, 0);
      expect(separated).toBe(true);

      const newDist = Math.hypot(b2.x - b1.x, b2.y - b1.y);
      expect(newDist).toBeGreaterThanOrEqual(2 * PhysicsConfig.R);
    });
  });
});
