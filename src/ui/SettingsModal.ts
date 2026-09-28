import { Game } from '../game/GameState';
import { DEFAULT_PRESET, KNOBS, KnobContext, KnobId, KnobValue, applyKnob, formatKnob } from '../sim/Knobs';
import {
  CUSTOM_ID, EVERYDAY_KNOBS, SavedSettings, advancedKnobs, loadSettings, namedPresetValues, presetChoices, saveSettings,
} from './PlayerSettings';
import { setHidden } from './Dom';
import { initAudio } from '../audio/SynthEngine';

/**
 * Binds the tuning-panel DOM inputs to the shared knob registry in
 * `sim/Knobs.ts`. This file owns only the DOM: reading `<input>` values, writing
 * `<output>` labels, and waking the AudioContext. What a knob actually *does*
 * lives in the registry, which the simulation harness drives by the same names.
 */
import { renderSoundTester, updateSoundTesterReadouts } from './SoundTester';

export interface SettingsHandle {
  /** The named preset being played, or null on Custom, which sets no records. */
  activePreset(): string | null;
}

export function setupSettingsKnobs(
  getGame: () => Game,
  getHeight: () => number = () => window.innerHeight
): SettingsHandle {
  // Render Sound FX Tester list in the options panel container if present
  const soundTesterContainer = document.getElementById('sound-tester-container');
  if (soundTesterContainer) {
    renderSoundTester(soundTesterContainer);
  }

  // Knobs that recompute scale-derived thresholds must see the height the
  // physics actually runs at — the stage, not the window, which is taller by
  // however much chrome the HUD and control strips occupy.
  const ctx = (): KnobContext => ({ game: getGame(), height: getHeight() });

  // The kickout readout also reports the derived chain percentage, so knobs that
  // move the boom thresholds have to refresh it as well as their own label.
  const refreshChainReadout = () => {
    const def = KNOBS.kickout;
    const el = document.getElementById('kickout') as HTMLInputElement | null;
    const out = document.getElementById('kickoutv');
    if (el && out) out.textContent = formatKnob(def, parseFloat(el.value), ctx());
  };

  // Each knob's applier, by id, so the preset picker can drive the same code path
  // a drag does instead of a second one that could diverge from it.
  const runners: Record<string, () => void> = {};
  const liveValues: Record<string, KnobValue> = {};
  // The picker's state: which choice is live, and what Custom holds.
  let selected: string = DEFAULT_PRESET;
  let custom: Record<string, KnobValue> = {};

  for (const def of Object.values(KNOBS)) {
    const el = document.getElementById(def.id) as HTMLInputElement | HTMLSelectElement | null;
    const out = document.getElementById(def.id + 'v');
    if (!el) continue;

    const run = () => {
      const raw = el.type === 'range' ? parseFloat(el.value) : el.value;
      liveValues[def.id] = raw;
      applyKnob(def, raw, ctx());
      if (out) out.textContent = formatKnob(def, raw, ctx());
      if (def.group === 'chain') refreshChainReadout();
      if (def.group === 'audio' || def.wakesAudio) updateSoundTesterReadouts();
    };
    runners[def.id] = run;

    // A slider reports every step on `input`; a `<select>` reports a pick on
    // `change`, which every browser fires, where `input` on a select is not
    // universal.
    const pickEvent = el.type.startsWith('select') ? 'change' : 'input';
    el.addEventListener(pickEvent, () => {
      if (def.wakesAudio) initAudio();
      run();
      knobChanged(def.id as KnobId);
    });
    run();
  }

  // --- Preset picker -------------------------------------------------------
  // Everyone sees the picker and the everyday settings. The rest of the panel is
  // Custom's: shown only there, and remembered between visits.
  const presetEl = document.getElementById('preset') as HTMLSelectElement | null;
  const advancedEl = document.getElementById('advanced');
  const choices = presetChoices();

  /** Move a knob the way a hand-drag would: the control, its readout, the config. */
  function setKnob(id: string, value: KnobValue) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) return;
    el.value = String(value);
    runners[id]?.();
  }

  function advancedNow(): Record<string, KnobValue> {
    const out: Record<string, KnobValue> = {};
    for (const id of advancedKnobs()) if (id in liveValues) out[id] = liveValues[id];
    return out;
  }

  function persist() {
    const player: Record<string, KnobValue> = {};
    for (const id of EVERYDAY_KNOBS) if (id in liveValues) player[id] = liveValues[id];
    const saved: SavedSettings = { preset: selected, custom, player };
    saveSettings(saved);
  }

  /**
   * Switch to a choice. A named preset sets every advanced knob, its own values
   * and the defaults for the rest, so nothing tuned in Custom follows the player
   * into it unseen. Custom brings back what it held, or, the first time, starts
   * from the game the player was just in.
   */
  function choose(id: string) {
    selected = id;
    if (id === CUSTOM_ID) {
      for (const [k, v] of Object.entries(custom)) setKnob(k, v);
      custom = advancedNow();
    } else {
      for (const [k, v] of Object.entries(namedPresetValues(id))) setKnob(k, v);
    }
    const label = choices.find(c => c.id === id)?.label;
    if (presetEl && label) presetEl.value = label;
    setHidden(advancedEl, id !== CUSTOM_ID);
    persist();
  }

  function knobChanged(id: KnobId) {
    if (selected === CUSTOM_ID && !EVERYDAY_KNOBS.includes(id)) custom[id] = liveValues[id];
    persist();
  }

  presetEl?.addEventListener('change', () => {
    choose(choices.find(c => c.label === presetEl.value)?.id ?? DEFAULT_PRESET);
  });

  // What this device kept from last time, if anything. The markup's values stand
  // until then, which are the default preset's.
  const saved = loadSettings();
  if (saved) {
    for (const [k, v] of Object.entries(saved.player)) setKnob(k, v);
    custom = saved.custom;
    choose(saved.preset);
  } else {
    const label = choices.find(c => c.id === DEFAULT_PRESET)?.label;
    if (presetEl && label) presetEl.value = label;
    setHidden(advancedEl, true);
  }

  return { activePreset: () => (selected === CUSTOM_ID ? null : selected) };
}
