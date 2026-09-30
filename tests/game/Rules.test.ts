import { describe, it, expect, beforeEach } from 'vitest';
import {
  COLORS,
  SPECIALS,
  setColorsCount,
  setSpecialsToggle,
  colorOfKind,
  toneOfKind,
  slotOfKind,
  drawFor,
  WHITE_ODDS,
  setWhiteOdds,
  PAY_LOCK,
  PAY_BOOM,
  PAY_PEEL,
  PAY_BLACK,
  PAY_BLACK_PAIR,
  SHOT_DECAY,
  lockPay,
  boomPay,
  peelPay,
  setShotDecay,
} from '../../src/game/Rules';
import { BALL_COLORS, BLACK_HEX, WHITE_HEX } from '../../src/graphics/Palette';
import { LauncherPlayer } from '../../src/physics/Types';

describe('Rules module', () => {
  beforeEach(() => {
    setColorsCount(3);
    setSpecialsToggle(true);
  });

  describe('setColorsCount & setSpecialsToggle', () => {
    it('clamps colors count between 3 and 6', () => {
      setColorsCount(2);
      expect(COLORS).toBe(3);

      setColorsCount(5);
      expect(COLORS).toBe(5);

      setColorsCount(10);
      expect(COLORS).toBe(6);
    });

    it('toggles specials flag correctly', () => {
      setSpecialsToggle(false);
      expect(SPECIALS).toBe(false);

      setSpecialsToggle(true);
      expect(SPECIALS).toBe(true);
    });
  });

  describe('pay table', () => {
    it('pays a lock per ball joined, growing with the size of the group it joins', () => {
      expect(lockPay(1, 0, 1)).toBe(PAY_LOCK);         // two single balls
      expect(lockPay(1, 0, 3)).toBe(2 * PAY_LOCK);     // one ball onto a 3-ball group
      expect(lockPay(1, 0, 9)).toBe(5 * PAY_LOCK);     // one ball onto a 9-ball group
      expect(lockPay(2, 0, 5)).toBe(2 * 3 * PAY_LOCK); // two balls onto a 5-ball group
    });

    it('doubles a lock through one black ball and quadruples black on black', () => {
      expect(PAY_BLACK).toBe(2);
      expect(PAY_BLACK_PAIR).toBe(4);
      expect(lockPay(1, 1, 3)).toBe(lockPay(1, 0, 3) * PAY_BLACK);
      expect(lockPay(1, 2, 3)).toBe(lockPay(1, 0, 3) * PAY_BLACK_PAIR);
    });

    it('pays a peel more the bigger the group, and always less than booming it', () => {
      expect(peelPay(1)).toBe(PAY_PEEL);
      expect(peelPay(3)).toBe(10);
      expect(peelPay(8)).toBe(23);
      for (let n = 2; n <= 12; n++) expect(peelPay(n)).toBeLessThan(boomPay(n));
    });

    it('pays small booms per ball and larger booms a growing per-ball bonus', () => {
      expect(boomPay(2)).toBe(2 * PAY_BOOM);
      expect(boomPay(3)).toBe(3 * PAY_BOOM);
      expect(boomPay(6)).toBe(6 * PAY_BOOM * 2);
      expect(boomPay(6, 0.5)).toBe(6 * PAY_BOOM);
    });

    it('pays more to boom a group than it paid to build it', () => {
      // Building used to pay the whole group again on every lock, so an
      // 8-ball group paid 105 to build and only 40 to boom.
      let build = 0;
      for (let n = 1; n < 8; n++) build += lockPay(1, 0, n);
      expect(boomPay(8)).toBeGreaterThan(build);
    });

    it('clamps shot decay to 0..1', () => {
      const was = SHOT_DECAY;
      try {
        setShotDecay(1.5);
        expect(SHOT_DECAY).toBe(1);
        setShotDecay(-1);
        expect(SHOT_DECAY).toBe(0);
      } finally {
        setShotDecay(was);
      }
    });
  });

  describe('colorOfKind', () => {
    it('returns colors corresponding to palette configuration', () => {
      setColorsCount(3);
      expect(colorOfKind(0)).toBe(BALL_COLORS[0]);
      expect(colorOfKind(1)).toBe(BALL_COLORS[1]);
      expect(colorOfKind(2)).toBe(BALL_COLORS[2]);
      // Wrap around
      expect(colorOfKind(3)).toBe(BALL_COLORS[0]);
    });

    it('handles negative kinds by wrapping correctly', () => {
      setColorsCount(3);
      expect(colorOfKind(-1)).toBe(BALL_COLORS[2]);
    });
  });

  describe('slotOfKind', () => {
    it('gives the black and white specials no slot, and wraps the rest like their colour', () => {
      setColorsCount(4);
      expect(slotOfKind(-1)).toBe(-1);
      expect([0, 1, 2, 3, 4].map(slotOfKind)).toEqual([0, 1, 2, 3, 0]);
      for (const k of [0, 1, 2, 3]) expect(colorOfKind(k)).toBe(BALL_COLORS[slotOfKind(k)]);
      setColorsCount(3);
    });
  });

  describe('toneOfKind', () => {
    it('calculates tone normalized between 0 and 1', () => {
      setColorsCount(3); // (COLORS - 1) = 2
      expect(toneOfKind(0)).toBe(0);
      expect(toneOfKind(1)).toBe(0.5);
      expect(toneOfKind(2)).toBe(1.0);
    });

    it('handles single color case safely', () => {
      // Force edge case test
      setColorsCount(1);
      // setColorsCount clamps to Math.max(3, ...), so COLORS remains 3
      expect(toneOfKind(0)).toBe(0);
    });
  });


  describe('drawFor', () => {
    it('generates a valid regular ball deck item', () => {
      setSpecialsToggle(false);
      const ball = drawFor();
      expect(ball.kind).toBeGreaterThanOrEqual(0);
      expect(ball.kind).toBeLessThan(COLORS);
      expect(ball.special).toBeNull();
      expect(typeof ball.color).toBe('string');
    });

    it('gives black to the player ahead and white to the player behind', () => {
      setSpecialsToggle(true);
      const leader: LauncherPlayer = { side: 1, score: 10 } as any;
      const trailer: LauncherPlayer = { side: -1, score: 2 } as any;
      const players = [leader, trailer];

      let blackProduced = 0;
      let whiteProduced = 0;

      for (let i = 0; i < 2000; i++) {
        const fromLeader = drawFor(leader, players, true);
        expect(fromLeader.special).not.toBe('white');
        if (fromLeader.special === 'black') {
          blackProduced++;
          expect(fromLeader.kind).toBe(-1);
          expect(fromLeader.color).toBe(BLACK_HEX);
        }

        const fromTrailer = drawFor(trailer, players, true);
        expect(fromTrailer.special).not.toBe('black');
        if (fromTrailer.special === 'white') {
          whiteProduced++;
          expect(fromTrailer.kind).toBe(-1);
          expect(fromTrailer.color).toBe(WHITE_HEX);
        }
      }

      expect(blackProduced).toBeGreaterThan(0);
      expect(whiteProduced).toBeGreaterThan(0);
      expect(whiteProduced).toBeLessThan(blackProduced);
    });

    it('scales the trailing player\'s white rate with the white knob', () => {
      setSpecialsToggle(true);
      setColorsCount(3);
      const was = WHITE_ODDS;
      const leader: LauncherPlayer = { side: 1, score: 10 } as any;
      const trailer: LauncherPlayer = { side: -1, score: 2 } as any;
      const players = [leader, trailer];
      const draws = 40000;

      const rate = (odds: number) => {
        setWhiteOdds(odds);
        let white = 0;
        for (let i = 0; i < draws; i++) {
          if (drawFor(trailer, players, true).special === 'white') white++;
        }
        return white / draws;
      };

      try {
        // Off means off: no white at all, and black is left alone.
        expect(rate(0)).toBe(0);
        setWhiteOdds(0);
        let black = 0;
        for (let i = 0; i < 2000; i++) {
          if (drawFor(leader, players, true).special === 'black') black++;
        }
        expect(black).toBeGreaterThan(0);

        // The chance per draw is odds / (COLORS + 1). This runs on the real
        // Math.random, so the guard has to clear sampling noise outright: at
        // 40k draws the standard error is about 0.2 points, and 1.5 points is
        // seven of them. `toBeCloseTo(v, 2)` would allow only 0.5 points \u2014
        // under three standard errors, which is a test that flakes.
        for (const odds of [0.5, 0.75, 1]) {
          expect(Math.abs(rate(odds) - odds / (COLORS + 1))).toBeLessThan(0.015);
        }
      } finally {
        setWhiteOdds(was);
      }
    });

    it('draws black for the leading player twice as often as any single colour', () => {
      setSpecialsToggle(true);
      const p1: LauncherPlayer = { side: 1, score: 10 } as any;
      const p2: LauncherPlayer = { side: -1, score: 2 } as any;
      const players = [p1, p2];
      const draws = 20000;
      let black = 0;
      const perKind = new Array(COLORS).fill(0);

      for (let i = 0; i < draws; i++) {
        const b = drawFor(p1, players, true);
        if (b.special === 'black') black++;
        else perKind[b.kind]++;
      }

      expect(black / draws).toBeCloseTo(2 / (COLORS + 2), 1);
      for (const n of perKind) expect(black / n).toBeGreaterThan(1.7);
      for (const n of perKind) expect(black / n).toBeLessThan(2.3);
    });

    it('never produces special black/white ball when either player is at score 0 or equal score', () => {
      setSpecialsToggle(true);
      const p1: LauncherPlayer = { side: 1, score: 0 } as any;
      const p2: LauncherPlayer = { side: -1, score: 5 } as any;
      const players = [p1, p2];

      for (let i = 0; i < 200; i++) {
        const b1 = drawFor(p1, players, true);
        const b2 = drawFor(p2, players, true);
        expect(b1.special).toBeNull();
        expect(b2.special).toBeNull();
      }
    });

    it('safely handles unlisted player in drawFor without throwing TypeError', () => {
      setSpecialsToggle(true);
      const p1: LauncherPlayer = { side: 1, score: 10 } as any;
      const p2: LauncherPlayer = { side: -1, score: 0 } as any;
      const unlisted: LauncherPlayer = { side: 1, score: 5 } as any;

      expect(() => drawFor(unlisted, [p1, p2], true)).not.toThrow();
      const ball = drawFor(unlisted, [p1, p2], true);
      expect(ball).toBeDefined();
    });

    it('produces both black and white balls for solo player when score > 0', () => {
      setSpecialsToggle(true);
      const soloPlayer: LauncherPlayer = { side: 1, score: 10 } as any;

      let blackProduced = 0;
      let whiteProduced = 0;

      for (let i = 0; i < 3000; i++) {
        const ball = drawFor(soloPlayer, [soloPlayer], false);
        if (ball.special === 'black') {
          blackProduced++;
          expect(ball.kind).toBe(-1);
          expect(ball.color).toBe(BLACK_HEX);
        } else if (ball.special === 'white') {
          whiteProduced++;
          expect(ball.kind).toBe(-1);
          expect(ball.color).toBe(WHITE_HEX);
        }
      }

      expect(blackProduced).toBeGreaterThan(0);
      expect(whiteProduced).toBeGreaterThan(0);
      expect(whiteProduced).toBeLessThan(blackProduced);
    });

    it('does not produce special balls for solo player when score is 0', () => {
      setSpecialsToggle(true);
      const soloPlayer: LauncherPlayer = { side: 1, score: 0 } as any;

      for (let i = 0; i < 200; i++) {
        const ball = drawFor(soloPlayer, [soloPlayer], false);
        expect(ball.special).toBeNull();
      }
    });
  });
});
