import { describe, it, expect } from 'vitest';
import { boomLabel, popScale, popText, scoreText } from '../../src/graphics/PopText';

/**
 * These assertions moved here from `tests/physics/CollisionSolver.test.ts` on
 * 2026-09-19, unchanged in substance, when the wording moved out of the solver.
 * What a pop says is presentation; the solver records only what happened.
 */
describe('PopText', () => {
  describe('boomLabel', () => {
    it('steps the word up with the size of the boom', () => {
      expect(boomLabel(4, false)).toBe('');
      expect(boomLabel(5, false)).toBe('DOUBLE');
      expect(boomLabel(9, false)).toBe('DOUBLE');
      expect(boomLabel(10, false)).toBe('SUPER');
      expect(boomLabel(14, false)).toBe('SUPER');
      expect(boomLabel(15, false)).toBe('MEGA');
      expect(boomLabel(19, false)).toBe('MEGA');
      expect(boomLabel(20, false)).toBe('GIGA');
      expect(boomLabel(40, false)).toBe('GIGA');
    });

    it('uses the same tier boundaries as the boom voice the player hears', () => {
      // getBoomProps is synthesized in tiers at 0..4, 5..9, 10..14,
      // 15..19 and 20+. The word and the sound must step together.
      for (const [count, word] of [[4, ''], [5, 'DOUBLE'], [10, 'SUPER'], [15, 'MEGA'], [20, 'GIGA']] as const) {
        expect(boomLabel(count, false)).toBe(word);
      }
    });

    it('reserves BOOM! for the white-on-black hit', () => {
      expect(boomLabel(3, true)).toBe('BOOM!');
      expect(boomLabel(3, false)).toBe('');
    });

    it('combines the tier with BOOM! when a white-on-black hit is also big', () => {
      expect(boomLabel(12, true)).toBe('SUPER BOOM!');
      expect(boomLabel(25, true)).toBe('GIGA BOOM!');
    });
  });

  describe('scoreText', () => {
    it('puts the boom word beside the points', () => {
      expect(scoreText(7, 'boom', { count: 6, whiteBlack: false })).toBe('+7 DOUBLE');
      expect(scoreText(13, 'boom', { count: 11, whiteBlack: false })).toBe('+13 SUPER');
      expect(scoreText(96, 'boom', { count: 12, whiteBlack: true })).toBe('+96 SUPER BOOM!');
    });

    it('leaves a small boom, and every lock and peel, as bare points', () => {
      expect(scoreText(9, 'boom', { count: 3, whiteBlack: false })).toBe('+9');
      expect(scoreText(12, 'lock')).toBe('+12');
      expect(scoreText(23, 'peel')).toBe('+23');
      expect(scoreText(7)).toBe('+7');
    });
  });

  describe('popText', () => {
    it('shows a carried word as it is, for the menu and the results screen', () => {
      expect(popText({ text: 'WINNER!' })).toBe('WINNER!');
      expect(popText({ text: 'BOND!' })).toBe('BOND!');
    });

    it('formats a scoring label the same way scoreText does', () => {
      expect(popText({ points: 96, source: 'boom', boom: { count: 12, whiteBlack: true } }))
        .toBe('+96 SUPER BOOM!');
      expect(popText({ points: 12, source: 'lock' })).toBe('+12');
    });
  });

  describe('popScale', () => {
    it('draws small events smaller, in four steps, with the old size as the largest', () => {
      expect(popScale({ points: 1, source: 'lock' })).toBe(0.6);
      expect(popScale({ points: 4, source: 'peel' })).toBe(0.6);
      expect(popScale({ points: 5, source: 'lock' })).toBe(0.72);
      expect(popScale({ points: 14, source: 'boom', boom: { count: 3, whiteBlack: false } })).toBe(0.72);
      expect(popScale({ points: 15, source: 'lock' })).toBe(0.84);
      expect(popScale({ points: 49, source: 'lock' })).toBe(0.84);
      expect(popScale({ points: 50, source: 'lock' })).toBe(1);
      expect(popScale({ points: 600, source: 'boom', boom: { count: 20, whiteBlack: false } })).toBe(1);
    });

    it('always draws a pop with a word at full size, however few its points', () => {
      // A long throw's decay can leave a DOUBLE worth only a few points.
      expect(popScale({ points: 6, source: 'boom', boom: { count: 5, whiteBlack: false } })).toBe(1);
      expect(popScale({ points: 3, source: 'boom', boom: { count: 2, whiteBlack: true } })).toBe(1);
      expect(popScale({ text: 'WINNER!' })).toBe(1);
    });
  });
});

