import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_PRESET, KNOBS, PRESETS, PRESET_SPAN, applyKnobDefaults, applyKnobs, applyPreset,
  knobIds, parseKnobValue, presetIds, presetKnobs, presetMatching, readKnobs,
  restoreConfig, snapshotConfig,
} from '../../src/sim/Knobs';
import { createGame } from '../../src/game/GameState';
import { PhysicsConfig } from '../../src/physics/Config';
import { AudioStore } from '../../src/audio/SynthEngine';

/**
 * Parse the `<input>`/`<select>` attributes out of index.html.
 *
 * A harness whose defaults do not match the markup measures a game nobody
 * plays: every stub knob reading zero means `kick = 0`, balls spawn motionless,
 * and the failure looks like a launcher bug rather than a harness bug.
 */
function panelMarkup(): string {
  const src = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
  const start = src.indexOf('<div id="panel"');
  expect(start, 'index.html has no #panel element').toBeGreaterThan(-1);
  // The panel ends at the settings textarea that closes it; the aim/power
  // sliders that follow belong to the control strips, not the tuning panel.
  const end = src.indexOf('<textarea id="settings"', start);
  return src.slice(start, end);
}

function markupKnobs(): Record<string, Record<string, string>> {
  const src = panelMarkup();
  const out: Record<string, Record<string, string>> = {};

  for (const m of src.matchAll(/<input\s+([^>]*)>/g)) {
    const attrs = m[1];
    const id = /id="([\w-]+)"/.exec(attrs);
    if (!id) continue;
    const d: Record<string, string> = { kind: 'range' };
    for (const k of ['min', 'max', 'step', 'value', 'type']) {
      const g = new RegExp(k + '="([^"]*)"').exec(attrs);
      if (g) d[k] = g[1];
    }
    out[id[1]] = d;
  }

  for (const m of src.matchAll(/<select\s+([^>]*)>([\s\S]*?)<\/select>/g)) {
    const id = /id="([\w-]+)"/.exec(m[1]);
    if (!id) continue;
    // The preset picker lives in the panel but is not a knob: it *sets* knobs.
    // `preset controls` below holds it to the PRESETS registry the same way.
    if (id[1] === 'preset') continue;
    const options = [...m[2].matchAll(/<option>([^<]*)<\/option>/g)].map(o => o[1].trim());
    out[id[1]] = { kind: 'select', options: options.join('|'), value: options[0] };
  }
  return out;
}

function markupPresetOptions(): string[] {
  const src = panelMarkup();
  const m = /<select\s+id="preset"[^>]*>([\s\S]*?)<\/select>/.exec(src);
  expect(m, 'index.html has no #preset select in the panel').not.toBeNull();
  return [...m![1].matchAll(/<option>([^<]*)<\/option>/g)].map(o => o[1].trim());
}

describe('knob registry', () => {
  const markup = markupKnobs();

  it('covers exactly the controls the tuning panel renders', () => {
    // Exact equality in both directions: a panel control with no registry entry
    // is a knob the harness cannot reach, and a registry entry with no control
    // is a knob no player can set.
    expect(Object.keys(markup).sort()).toEqual(knobIds().sort());
  });

  // The registry is the single source of truth for the harness; if the markup
  // drifts from it, the simulation stops measuring the shipping defaults.
  for (const id of Object.keys(KNOBS)) {
    const def = KNOBS[id];
    it(`"${id}" matches its markup range and default`, () => {
      const m = markup[id];
      expect(m, `no control for ${id} in index.html`).toBeDefined();

      if (def.kind === 'select') {
        expect(m.options?.split('|')).toEqual(def.options);
        expect(m.value).toBe(def.default);
        return;
      }

      expect(parseFloat(m.min!), `${id} min`).toBe(def.min);
      expect(parseFloat(m.max!), `${id} max`).toBe(def.max);
      expect(parseFloat(m.step!), `${id} step`).toBe(def.step);
      expect(parseFloat(m.value!), `${id} default`).toBe(def.default);
    });
  }
});

describe('knob application', () => {
  it('applies defaults so a run starts from the real page-load state', () => {
    const snap = snapshotConfig();
    try {
      PhysicsConfig.REST = 0.1;
      applyKnobDefaults({ game: createGame(), height: 620 });
      expect(PhysicsConfig.REST).toBe(KNOBS.bounce.default);
      // bounce drives the wall restitution too, at 80% of ball-on-ball.
      expect(PhysicsConfig.REST_WALL).toBeCloseTo((KNOBS.bounce.default as number) * 0.8, 10);
    } finally {
      restoreConfig(snap);
    }
  });

  it('reads every knob back after applying it', () => {
    const snap = snapshotConfig();
    try {
      const ctx = { game: createGame(), height: 620 };
      applyKnobDefaults(ctx);
      applyKnobs({ boom: 0.8, minboom: 4, rain: 2.5 }, ctx);
      const read = readKnobs(ctx);
      expect(read.boom).toBe(0.8);
      expect(read.minboom).toBe(4);
      expect(read.rain).toBe(2.5);
    } finally {
      restoreConfig(snap);
    }
  });

  it('recomputes derived thresholds when a chain knob moves', () => {
    const snap = snapshotConfig();
    try {
      const ctx = { game: createGame(), height: 620 };
      applyKnobDefaults(ctx);
      const before = PhysicsConfig.BOOM_SPEED;
      applyKnobs({ boom: 1.0 }, ctx);
      expect(PhysicsConfig.BOOM_SPEED).not.toBe(before);
      expect(PhysicsConfig.BOOM_SPEED).toBeCloseTo(PhysicsConfig.THROW_MAX * PhysicsConfig.SC, 6);
    } finally {
      restoreConfig(snap);
    }
  });

  it('restores shared config so one run cannot leak into the next', () => {
    const snap = snapshotConfig();
    const originalRest = PhysicsConfig.REST;
    applyKnobs({ bounce: 0.5 }, { game: createGame(), height: 620 });
    expect(PhysicsConfig.REST).toBe(0.5);
    restoreConfig(snap);
    expect(PhysicsConfig.REST).toBe(originalRest);
  });

  it('rejects unknown knobs rather than ignoring them', () => {
    expect(() => applyKnobs({ nonesuch: 1 }, { game: createGame(), height: 620 })).toThrow(/Unknown knob/);
    expect(() => parseKnobValue('nonesuch', '1')).toThrow(/Unknown knob/);
  });

  it('rejects values outside the slider range a player can reach', () => {
    expect(() => parseKnobValue('boom', '5')).toThrow(/above its maximum/);
    expect(() => parseKnobValue('boom', '0')).toThrow(/below its minimum/);
    expect(() => parseKnobValue('boom', 'loud')).toThrow(/needs a number/);
    expect(parseKnobValue('boom', '0.55')).toBe(0.55);
  });
});

describe('preset controls', () => {
  it('offers exactly the presets the registry declares, in the same order, then the Custom slots', () => {
    // The Custom slots are the panel's own choices, not registry presets: they
    // have no fixed values, so the harness has nothing to apply for them.
    expect(markupPresetOptions()).toEqual([...Object.values(PRESETS).map(p => p.label), 'Custom 1', 'Custom 2', 'Custom 3']);
  });

  it('opens on the default preset, which a bare <select> takes from its first option', () => {
    expect(markupPresetOptions()[0]).toBe(PRESETS[DEFAULT_PRESET].label);
  });

  it('defines the default preset as the registry defaults themselves', () => {
    // If `normal` ever grows an override, the panel and the harness would start
    // from different games: the markup ships the defaults, not the preset.
    expect(PRESETS[DEFAULT_PRESET].knobs).toEqual({});
    for (const id of PRESET_SPAN) {
      expect(presetKnobs(DEFAULT_PRESET)[id], `${id} in the default preset`).toBe(KNOBS[id].default);
    }
  });

  it('keeps every preset value inside the range a player can reach', () => {
    for (const id of presetIds()) {
      for (const [knobId, value] of Object.entries(PRESETS[id].knobs)) {
        expect(() => parseKnobValue(knobId, String(value)), `${id}.${knobId}`).not.toThrow();
      }
    }
  });

  it('never lets a preset touch an audio or cosmetic knob', () => {
    // Picking Chaos must not reset someone's volume or their ball numbers.
    for (const id of PRESET_SPAN) {
      expect(KNOBS[id].cosmetic ?? false, `${id} is cosmetic`).toBe(false);
      expect(KNOBS[id].group, `${id} group`).not.toBe('audio');
    }
  });

  it('spans exactly the knobs the presets mention', () => {
    const mentioned = new Set<string>();
    for (const id of presetIds()) for (const k of Object.keys(PRESETS[id].knobs)) mentioned.add(k);
    expect([...PRESET_SPAN].sort()).toEqual([...mentioned].sort());
  });

  it('undoes the previous preset instead of layering on top of it', () => {
    const snap = snapshotConfig();
    try {
      const ctx = { game: createGame(), height: 620 };
      applyKnobDefaults(ctx);
      applyPreset('relax', ctx);
      expect(PhysicsConfig.MIN_BOOM).toBe(3);
      // `minboom` is a relax override that chaos does not mention, so it has to
      // come back to its default when chaos is picked.
      applyPreset('chaos', ctx);
      expect(PhysicsConfig.MIN_BOOM).toBe(KNOBS.minboom.default);
      expect(PhysicsConfig.DRAG).toBe(0.75);
      applyPreset('normal', ctx);
      expect(PhysicsConfig.DRAG).toBe(KNOBS.roll.default);
      expect(PhysicsConfig.REST).toBe(KNOBS.bounce.default);
    } finally {
      restoreConfig(snap);
    }
  });

  it('recognises its own presets and reports a nudged knob as no preset at all', () => {
    for (const id of presetIds()) {
      expect(presetMatching(presetKnobs(id))).toBe(id);
    }
    const nudged = { ...presetKnobs('relax'), reload: 2.5 };
    expect(presetMatching(nudged)).toBeNull();
  });

  it('rejects an unknown preset rather than silently falling back', () => {
    expect(() => applyPreset('nonesuch', { game: createGame(), height: 620 })).toThrow(/Unknown preset/);
  });
});

/**
 * The module literals must agree with the knob defaults.
 *
 * `PhysicsConfig`, `AudioStore` and a new `Game` all carry authored literals for
 * fields a knob controls, and both the tuning panel and the harness overwrite
 * them at start-up. That makes a stale literal invisible in play but misleading
 * to read: PR #2 moved four knob defaults and no literal followed, so the source
 * said `DRAG: 0.45` where the game shipped 0.59.
 *
 * This is the same guard `index.html` already gets above: one declaration point
 * for a knob, and a test that fails when a second copy disagrees. Fields derived
 * from others by `recalcThresholds` are excluded, since they are computed rather
 * than authored.
 */
describe('knob defaults match the module literals', () => {
  /** Recomputed by `recalcThresholds` from other fields, so not authored. */
  const DERIVED = new Set(['BOOM_SPEED', 'KICKOUT_MAX', 'THROW_MIN', 'THROW_MAX', 'SC']);

  it('leaves no field whose literal disagrees with its knob default', () => {
    const game = createGame();
    const literalPhys: Record<string, unknown> = { ...PhysicsConfig };
    const literalAudio: Record<string, unknown> = { ...AudioStore };
    const literalMatchLen = game.matchLen;

    const snap = snapshotConfig();
    try {
      applyKnobDefaults({ game, height: 620 });

      const drift: string[] = [];
      for (const [k, was] of Object.entries(literalPhys)) {
        if (DERIVED.has(k)) continue;
        const now = (PhysicsConfig as Record<string, unknown>)[k];
        if (typeof was === 'number' && typeof now === 'number' && Math.abs(was - now) > 1e-9) {
          drift.push(`PhysicsConfig.${k}: literal ${was}, knob default ${now}`);
        }
      }
      for (const k of ['vol', 'lockVol', 'breakVol', 'boomVol', 'clickVol', 'droneVol']) {
        const was = literalAudio[k];
        const now = (AudioStore as Record<string, unknown>)[k];
        if (typeof was === 'number' && typeof now === 'number' && Math.abs(was - now) > 1e-9) {
          drift.push(`AudioStore.${k}: literal ${was}, knob default ${now}`);
        }
      }
      if (Math.abs(literalMatchLen - game.matchLen) > 1e-9) {
        drift.push(`Game.matchLen: literal ${literalMatchLen}, knob default ${game.matchLen}`);
      }

      expect(drift, 'update the literal, or the knob default, so they agree').toEqual([]);
    } finally {
      restoreConfig(snap);
    }
  });
});
