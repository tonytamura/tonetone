import { describe, it, expect, afterEach } from 'vitest';
import { AUTO_MARK_COLORS, MARK_SHAPES, markOfKind, marksShown } from '../../src/graphics/BallMarks';
import { MAX_COLORS, setColorsCount } from '../../src/game/Rules';

describe('the shapes on the balls', () => {
  afterEach(() => setColorsCount(3));

  it('come on by themselves from five colours, and at any count when asked', () => {
    expect(AUTO_MARK_COLORS).toBe(5);
    for (const n of [3, 4]) { setColorsCount(n); expect(marksShown(false)).toBe(false); expect(marksShown(true)).toBe(true); }
    for (const n of [5, 6]) { setColorsCount(n); expect(marksShown(false)).toBe(true); }
  });

  it('give every colour slot its own shape, and the specials none', () => {
    expect(new Set(MARK_SHAPES).size).toBe(MAX_COLORS);
    setColorsCount(MAX_COLORS);
    expect(Array.from({ length: MAX_COLORS }, (_, k) => markOfKind(k))).toEqual([...MARK_SHAPES]);
    expect(markOfKind(-1)).toBeNull();
  });
});
