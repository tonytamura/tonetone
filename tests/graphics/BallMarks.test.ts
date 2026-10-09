import { describe, it, expect, afterEach } from 'vitest';
import { MARK_SHAPES, markOfKind, marksShown } from '../../src/graphics/BallMarks';
import { createGame } from '../../src/game/GameState';
import { KNOBS, PRESETS, applyKnobDefaults, applyPreset, snapshotConfig, restoreConfig } from '../../src/sim/Knobs';
import { MAX_COLORS, setColorsCount } from '../../src/game/Rules';

describe('the shapes on the balls', () => {
  afterEach(() => setColorsCount(3));

  it('are off unless turned on, at any number of colours', () => {
    for (const n of [3, 4, 5, 6]) { setColorsCount(n); expect([0, 1].map(marksShown)).toEqual([false, true]); }
  });

  it('are off by default in every preset, the six-colour ones included', () => {
    // They used to come on by themselves from five colours, so Cascade, Drift
    // and Rally showed them unasked (Tony, 2026-10-09).
    expect(KNOBS.labels.default).toBe(0);
    const saved = snapshotConfig();
    try {
      for (const id of Object.keys(PRESETS)) {
        const game = createGame();
        applyKnobDefaults({ game, height: 620 });
        applyPreset(id, { game, height: 620 });
        expect(marksShown(game.marks), id).toBe(false);
      }
    } finally { restoreConfig(saved); }
  });

  it('give every colour slot its own shape, and the specials none', () => {
    expect(new Set(MARK_SHAPES).size).toBe(MAX_COLORS);
    setColorsCount(MAX_COLORS);
    expect(Array.from({ length: MAX_COLORS }, (_, k) => markOfKind(k))).toEqual([...MARK_SHAPES]);
    expect(markOfKind(-1)).toBeNull();
  });
});
