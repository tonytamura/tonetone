import { describe, it, expect, afterEach } from 'vitest';
import { AUTO_MARK_COLORS, MARK_SHAPES, markOfKind, marksShown } from '../../src/graphics/BallMarks';
import { MAX_COLORS, setColorsCount } from '../../src/game/Rules';

describe('the shapes on the balls', () => {
  afterEach(() => setColorsCount(3));

  it('come on by themselves from five colours, always when asked, and never when turned off', () => {
    expect(AUTO_MARK_COLORS).toBe(5);
    for (const n of [3, 4]) { setColorsCount(n); expect([0, 1, 2].map(marksShown)).toEqual([false, true, false]); }
    for (const n of [5, 6]) { setColorsCount(n); expect([0, 1, 2].map(marksShown)).toEqual([true, true, false]); }
  });

  it('give every colour slot its own shape, and the specials none', () => {
    expect(new Set(MARK_SHAPES).size).toBe(MAX_COLORS);
    setColorsCount(MAX_COLORS);
    expect(Array.from({ length: MAX_COLORS }, (_, k) => markOfKind(k))).toEqual([...MARK_SHAPES]);
    expect(markOfKind(-1)).toBeNull();
  });
});
