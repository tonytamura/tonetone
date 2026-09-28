import { describe, it, expect } from 'vitest';
import { KeyValueStore } from '../../src/ui/Progress';
import { KNOBS, PRESETS, PRESET_SPAN, presetIds } from '../../src/sim/Knobs';
import {
  CUSTOM_ID, EVERYDAY_KNOBS, SETTINGS_KEY, advancedKnobs, loadSettings, namedPresetValues, presetChoices,
  sanitize, saveSettings,
} from '../../src/ui/PlayerSettings';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

describe('the preset picker', () => {
  it('offers the registry presets in order, then Custom', () => {
    expect(presetChoices().map(c => c.id)).toEqual([...presetIds(), CUSTOM_ID]);
  });

  it('keeps ball numbers, volume and haptics outside Custom, and everything else in it', () => {
    expect(EVERYDAY_KNOBS).toContain('labels'); // the colour-blind option never hides
    expect(new Set([...EVERYDAY_KNOBS, ...advancedKnobs()]).size).toBe(Object.keys(KNOBS).length);
    for (const id of EVERYDAY_KNOBS) expect(PRESET_SPAN, `${id} must not be a preset knob`).not.toContain(id);
  });

  it('makes a named preset a whole game: its own values, and defaults for the rest', () => {
    const relax = namedPresetValues('relax');
    expect(Object.keys(relax).sort()).toEqual([...advancedKnobs()].sort());
    for (const [k, v] of Object.entries(PRESETS.relax.knobs)) expect(relax[k]).toBe(v);
    expect(relax.specials).toBe(KNOBS.specials.default);
  });
});

describe('saved settings', () => {
  it('round-trip', () => {
    const s = memoryStore();
    saveSettings({ preset: CUSTOM_ID, custom: { reload: 6, roll: 0.3 }, player: { vol: 0.5, labels: 1 } }, s);
    expect(loadSettings(s)).toEqual({ preset: CUSTOM_ID, custom: { reload: 6, roll: 0.3 }, player: { vol: 0.5, labels: 1 } });
  });

  it('read as nothing when absent, corrupt or from another version', () => {
    const s = memoryStore();
    expect(loadSettings(s)).toBeNull();
    for (const raw of ['{bad', 'null', '{"v":2,"preset":"relax"}']) {
      s.data.set(SETTINGS_KEY, raw);
      expect(loadSettings(s), raw).toBeNull();
    }
  });

  it('never let a stored value past what the sliders allow', () => {
    const s = memoryStore();
    s.data.set(SETTINGS_KEY, JSON.stringify({
      v: 1, preset: 'nonesuch',
      custom: { reload: 99, roll: -1, boom: 0.43, nosuchknob: 3, vol: 1, kick: 'fast' },
      player: { vol: 0.5, reload: 2, haptics: 7 },
    }));
    expect(loadSettings(s)).toEqual({
      preset: presetIds()[0], // an unknown preset falls back to the default
      custom: { reload: KNOBS.reload.max, roll: KNOBS.roll.min, boom: 0.45 }, // clamped, snapped, unknowns and wrong types dropped
      player: { vol: 0.5, haptics: 1 }, // a gameplay knob cannot sneak in as a player setting
    });
  });

  it('survive a store that throws', () => {
    const broken: KeyValueStore = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('y'); } };
    expect(loadSettings(broken)).toBeNull();
    expect(() => saveSettings({ preset: 'normal', custom: {}, player: {} }, broken)).not.toThrow();
  });

  it('snap to the slider grid in the step\'s own precision', () => {
    expect(sanitize('boom', 0.43)).toBe(0.45);
    expect(sanitize('roll', 0.333)).toBe(0.33);
    expect(sanitize('size', 12.4)).toBe(12);
    expect(sanitize('nosuch', 1)).toBeUndefined();
  });
});
