import { describe, it, expect, afterEach, vi } from 'vitest';
import { setupSettingsKnobs } from '../../src/ui/SettingsModal';
import { createGame } from '../../src/game/GameState';
import { PhysicsConfig } from '../../src/physics/Config';
import { SHOT_DECAY } from '../../src/game/Rules';
import {
  KNOBS, PRESETS, PRESET_SPAN, presetKnobs, restoreConfig, snapshotConfig,
} from '../../src/sim/Knobs';

/**
 * The preset picker, exercised through the DOM the panel actually reads.
 *
 * The suite runs in a node environment, so this builds the small slice of a
 * document that `setupSettingsKnobs` touches. Only the knobs a preset can move
 * are served: an audio knob's applier reaches for an AudioContext and the sound
 * tester's own DOM, none of which this test is about, and the panel already
 * skips any knob whose element is missing.
 */

interface FakeEl {
  id: string;
  type: string;
  value: string;
  textContent: string;
  attrs: Record<string, string>;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  addEventListener(event: string, fn: () => void): void;
  fire(event: string): void;
}

function fakeEl(id: string, type: string, value = ''): FakeEl {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    id, type, value, textContent: '', attrs: {},
    setAttribute(name, v) { this.attrs[name] = v; },
    removeAttribute(name) { delete this.attrs[name]; },
    addEventListener(event, fn) { (listeners[event] ||= []).push(fn); },
    fire(event) { for (const fn of listeners[event] ?? []) fn(); },
  };
}

/**
 * A gameplay knob no preset declares, for the "presets leave the rest alone"
 * case. Derived rather than written down: this used to name `colours`, which the
 * Cascade, Drift and Rally presets now set to 6, so the case silently became a
 * test that a preset fails to apply one of its own knobs.
 */
const OUTSIDE_EVERY_PRESET = ['rain', 'spin', 'specials'].find(id => !PRESET_SPAN.includes(id))!;

function mountPanel() {
  const els = new Map<string, FakeEl>();
  // Every knob a preset can touch, plus one it cannot, at its registry default.
  for (const id of [...PRESET_SPAN, OUTSIDE_EVERY_PRESET]) {
    els.set(id, fakeEl(id, 'range', String(KNOBS[id].default)));
    els.set(id + 'v', fakeEl(id + 'v', 'output'));
  }
  els.set('preset', fakeEl('preset', 'select', PRESETS.normal.label));
  els.set('advanced', fakeEl('advanced', 'div'));

  (global as any).document = {
    getElementById: (id: string) => els.get(id) ?? null,
  };

  const game = createGame();
  const handle = setupSettingsKnobs(() => game, () => 620);
  return { els, game, handle, pick: (label: string) => { els.get('preset')!.value = label; els.get('preset')!.fire('change'); } };
}

describe('tuning panel preset picker', () => {
  const snap = snapshotConfig();
  afterEach(() => {
    restoreConfig(snap);
    delete (global as any).document;
  });

  it('applies every knob of the chosen preset to the live config', () => {
    const { pick, game } = mountPanel();
    pick(PRESETS.chaos.label);

    const want = presetKnobs('chaos');
    expect(PhysicsConfig.DRAG).toBe(want.roll);
    expect(PhysicsConfig.BOOM_AT).toBe(want.boom);
    expect(PhysicsConfig.KICKOUT_FRAC).toBe(want.kickout);
    expect(PhysicsConfig.THROW_MAX).toBe(want.maxpower);
    expect(PhysicsConfig.SPEED_CAP).toBe(want.speedcap);
    expect(game.reloadTime).toBe(want.reload);
  });

  it('moves the sliders and their readouts, not just the config', () => {
    // A picker that changed the game without moving the controls would leave the
    // panel describing a game the player is no longer in.
    const { els, pick } = mountPanel();
    pick(PRESETS.relax.label);

    expect(els.get('roll')!.value).toBe('0.45');
    expect(els.get('rollv')!.textContent).toBe('7s');
    expect(els.get('reload')!.value).toBe('4.5');
    expect(els.get('reloadv')!.textContent).toBe('4.5s');
    expect(els.get('minboom')!.value).toBe('3');
    expect(els.get('minboomv')!.textContent).toBe('3+');
  });

  it('undoes a preset when another is picked, including knobs it does not mention', () => {
    const { pick } = mountPanel();
    pick(PRESETS.relax.label);
    expect(PhysicsConfig.MIN_BOOM).toBe(3);
    expect(SHOT_DECAY).toBe(0.7);

    pick(PRESETS.chaos.label);
    expect(PhysicsConfig.MIN_BOOM).toBe(KNOBS.minboom.default);
    expect(SHOT_DECAY).toBe(KNOBS.shotdecay.default);

    pick(PRESETS.normal.label);
    expect(PhysicsConfig.DRAG).toBe(KNOBS.roll.default);
    expect(PhysicsConfig.REST).toBe(KNOBS.bounce.default);
    expect(PhysicsConfig.THROW_MAX).toBe(KNOBS.maxpower.default);
  });

  it('sets every advanced knob on a named preset, the ones it does not declare to their defaults', () => {
    // A named preset is a whole game. Anything tuned in Custom is hidden outside
    // it, so it must not follow the player into Normal unseen.
    const { els, pick } = mountPanel();
    pick('Custom');
    const el = els.get(OUTSIDE_EVERY_PRESET)!;
    el.value = '0';
    el.fire('input');
    pick(PRESETS.chaos.label);
    expect(el.value).toBe(String(KNOBS[OUTSIDE_EVERY_PRESET].default));
  });

  it('shows the advanced knobs on Custom only', () => {
    const { els, pick } = mountPanel();
    const hidden = () => 'hidden' in els.get('advanced')!.attrs;
    pick(PRESETS.relax.label);
    expect(hidden()).toBe(true);
    pick('Custom');
    expect(hidden()).toBe(false);
    pick(PRESETS.normal.label);
    expect(hidden()).toBe(true);
  });

  it('starts Custom from the game the player was in, and remembers what it was given', () => {
    const { els, pick } = mountPanel();
    pick(PRESETS.relax.label);
    pick('Custom');
    expect(els.get('reload')!.value).toBe('4.5'); // Relax's, carried over

    els.get('reload')!.value = '6';
    els.get('reload')!.fire('input');
    pick(PRESETS.normal.label);
    expect(els.get('reload')!.value).toBe(String(KNOBS.reload.default));
    pick('Custom');
    expect(els.get('reload')!.value).toBe('6');
  });

  it('reports the named preset for records, and none on Custom', () => {
    const { handle, pick } = mountPanel();
    expect(handle.activePreset()).toBe('normal');
    pick(PRESETS.drift.label);
    expect(handle.activePreset()).toBe('drift');
    pick('Custom');
    expect(handle.activePreset()).toBeNull();
  });
});
