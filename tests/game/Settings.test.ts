import { describe, it, expect, afterEach } from 'vitest';
import { KNOB_IDS, settingsLine } from '../../src/game/Settings';
import { KNOBS, parseKnobValue } from '../../src/sim/Knobs';

/**
 * The "Copy these settings" line has to be usable as a `--set` payload.
 *
 * This is the guard for D1: the line used to be joined with spaces while `--set`
 * splits on commas, and it appended `boomspeed` and `breakoutmax`, which are not
 * knobs. Pasting it either failed outright or, before `parseKnobValue` rejected
 * trailing junk, applied only the first knob and reported a normal run. The test
 * therefore does what a person does with the line: split it the way the harness
 * does and parse every pair.
 *
 * The panel is a node-environment test, so this serves the small slice of the
 * document `settingsLine` reads: one element per knob at its registry default.
 */
function mountKnobs() {
  const els = new Map<string, { id: string; type: string; value: string }>();
  for (const id of KNOB_IDS) {
    const def = KNOBS[id];
    els.set(id, {
      id,
      type: def.kind === 'select' ? 'select-one' : 'range',
      value: String(def.default),
    });
  }
  (global as any).document = { getElementById: (id: string) => els.get(id) ?? null };
  return els;
}

afterEach(() => {
  delete (global as any).document;
});

describe('settingsLine', () => {
  it('parses back as --set does: comma separated, every pair a real knob', () => {
    mountKnobs();
    const line = settingsLine();

    expect(line).not.toContain(' =');
    expect(line.split(',').length).toBe(KNOB_IDS.length);

    for (const part of line.split(',')) {
      const eq = part.indexOf('=');
      expect(eq).toBeGreaterThan(0);
      const id = part.slice(0, eq).trim();
      const raw = part.slice(eq + 1).trim();
      expect(KNOBS[id], `"${id}" is not a knob`).toBeDefined();
      expect(() => parseKnobValue(id, raw)).not.toThrow();
    }
  });

  it('carries every knob the registry declares and nothing else', () => {
    mountKnobs();
    const ids = settingsLine().split(',').map(p => p.slice(0, p.indexOf('=')));
    expect(ids).toEqual(KNOB_IDS);
  });

  it('round-trips a changed value rather than the default', () => {
    const els = mountKnobs();
    els.get('boom')!.value = '0.45';
    const pair = settingsLine().split(',').find(p => p.startsWith('boom='));
    expect(pair).toBe('boom=0.45');
    expect(parseKnobValue('boom', '0.45')).toBe(0.45);
    // A value the slider cannot reach is refused, not run as if it could be.
    expect(() => parseKnobValue('boom', '0.42')).toThrow(/steps of 0.05/);
  });
});
