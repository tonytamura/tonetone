import { describe, it, expect } from 'vitest';
import { KeyValueStore } from '../../src/ui/Progress';
import { KNOBS, PRESETS, PRESET_SPAN, presetIds } from '../../src/sim/Knobs';
import {
  CUSTOM_SLOTS, EVERYDAY_KNOBS, SETTINGS_KEY, advancedKnobs, loadSettings, namedPresetValues, presetChoices,
  sanitize, saveSettings,
} from '../../src/ui/PlayerSettings';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

describe('the preset picker', () => {
  it('offers the registry presets in order, then three Custom slots', () => {
    expect(presetChoices().map(c => c.id)).toEqual([...presetIds(), 'custom1', 'custom2', 'custom3']);
    expect(CUSTOM_SLOTS.map(c => c.label)).toEqual(['Custom 1', 'Custom 2', 'Custom 3']);
  });

  it('starts every Custom slot from the registry defaults', () => {
    for (const { id } of CUSTOM_SLOTS) expect(namedPresetValues(id)).toEqual(namedPresetValues('normal'));
  });

  it('keeps ball numbers, volume, haptics and the AI opponent outside Custom, and everything else in it', () => {
    expect(EVERYDAY_KNOBS).toContain('labels'); // the colour-blind option never hides
    expect(EVERYDAY_KNOBS).toContain('ailevel'); // who to play is not a rule, so no preset resets it
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
    const kept = { preset: 'custom2', customs: { custom1: { reload: 6 }, custom2: { roll: 0.3 } }, player: { vol: 0.5, labels: 1 } };
    saveSettings(kept, s);
    expect(loadSettings(s)).toEqual(kept);
  });

  it('carry the single Custom of version 1 over into the first slot', () => {
    const s = memoryStore();
    s.data.set(SETTINGS_KEY, JSON.stringify({ v: 1, preset: 'custom', custom: { reload: 6 }, player: { vol: 0.5 } }));
    expect(loadSettings(s)).toEqual({ preset: 'custom1', customs: { custom1: { reload: 6 } }, player: { vol: 0.5 } });
  });

  it('read as nothing when absent, corrupt or from another version', () => {
    const s = memoryStore();
    expect(loadSettings(s)).toBeNull();
    for (const raw of ['{bad', 'null', '{"v":3,"preset":"relax"}']) {
      s.data.set(SETTINGS_KEY, raw);
      expect(loadSettings(s), raw).toBeNull();
    }
  });

  it('never let a stored value past what the sliders allow', () => {
    const s = memoryStore();
    s.data.set(SETTINGS_KEY, JSON.stringify({
      v: 2, preset: 'nonesuch',
      customs: { custom3: { reload: 99, roll: -1, boom: 0.43, nosuchknob: 3, vol: 1, kick: 'fast' }, custom9: { reload: 6 } },
      player: { vol: 0.5, reload: 2, haptics: 7 },
    }));
    expect(loadSettings(s)).toEqual({
      preset: presetIds()[0], // an unknown preset falls back to the default
      customs: { custom3: { reload: KNOBS.reload.max, roll: KNOBS.roll.min, boom: 0.45 } }, // clamped, snapped, unknowns and wrong types dropped, and no slot 9
      player: { vol: 0.5, haptics: 1 }, // a gameplay knob cannot sneak in as a player setting
    });
  });

  it('survive a store that throws', () => {
    const broken: KeyValueStore = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('y'); } };
    expect(loadSettings(broken)).toBeNull();
    expect(() => saveSettings({ preset: 'normal', customs: {}, player: {} }, broken)).not.toThrow();
  });

  it('snap to the slider grid in the step\'s own precision', () => {
    expect(sanitize('boom', 0.43)).toBe(0.45);
    expect(sanitize('roll', 0.333)).toBe(0.33);
    expect(sanitize('size', 12.4)).toBe(12);
    expect(sanitize('nosuch', 1)).toBeUndefined();
  });
});
