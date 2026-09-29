import { Game } from '../game/GameState';
import { DEFAULT_PRESET, KNOBS, KnobContext, KnobId, KnobValue, applyKnob, formatKnob } from '../sim/Knobs';
import {
  EVERYDAY_KNOBS, SavedSettings, advancedKnobs, isCustom, loadSettings, namedPresetValues, presetChoices, saveSettings,
} from './PlayerSettings';
import { setHidden } from './Dom';
import { onLanguageChange } from '../i18n/I18n';
import { initAudio } from '../audio/SynthEngine';

/**
 * Binds the tuning-panel DOM inputs to the shared knob registry in
 * `sim/Knobs.ts`. This file owns only the DOM: reading `<input>` values, writing
 * `<output>` labels, and waking the AudioContext. What a knob actually *does*
 * lives in the registry, which the simulation harness drives by the same names.
 */
// The sound preview lives on the Help screen now; a sound knob moved here still
// refreshes its readouts, if it is open.
import { updateSoundTesterReadouts } from './SoundTester';

export interface SettingsHandle {
  /** The named preset being played, or null on a Custom slot, which sets no records. */
  activePreset(): string | null;
  /** The picker's choice, a Custom slot included. */
  choice(): string;
  /** Switch to a choice, exactly as picking it in the panel does. */
  choose(id: string): void;
}

export function setupSettingsKnobs(
  getGame: () => Game,
  getHeight: () => number = () => window.innerHeight
): SettingsHandle {
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
  // The picker's state: which choice is live, and what each Custom slot holds.
  let selected: string = DEFAULT_PRESET;
  let customs: Record<string, Record<string, KnobValue>> = {};

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
  // Everyone sees the picker and the everyday settings. The rest of the panel
  // belongs to the Custom slots: shown only there, and remembered between visits.
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
    const saved: SavedSettings = { preset: selected, customs, player };
    saveSettings(saved);
  }

  /**
   * Switch to a choice. Every advanced knob is set, so nothing tuned in one
   * Custom slot follows the player into a named preset or another slot unseen.
   * A named preset sets its own values and the defaults for the rest. A Custom
   * slot brings back what it held, over the defaults it started from the first
   * time it was opened.
   */
  function choose(id: string) {
    if (!choices.some(c => c.id === id)) id = DEFAULT_PRESET;
    selected = id;
    const values = { ...namedPresetValues(id), ...(isCustom(id) ? customs[id] : {}) };
    for (const [k, v] of Object.entries(values)) setKnob(k, v);
    if (isCustom(id)) customs[id] = advancedNow();
    // The options carry the ids as their values; their text is the translated name.
    if (presetEl) presetEl.value = id;
    setHidden(advancedEl, !isCustom(id));
    persist();
  }

  function knobChanged(id: KnobId) {
    if (isCustom(selected) && !EVERYDAY_KNOBS.includes(id)) customs[selected][id] = liveValues[id];
    persist();
  }

  presetEl?.addEventListener('change', () => {
    choose(choices.some(c => c.id === presetEl.value) ? presetEl.value : DEFAULT_PRESET);
  });

  // What this device kept from last time, if anything. The markup's values stand
  // until then, which are the default preset's.
  const saved = loadSettings();
  if (saved) {
    for (const [k, v] of Object.entries(saved.player)) setKnob(k, v);
    customs = saved.customs;
    choose(saved.preset);
  } else {
    if (presetEl) presetEl.value = DEFAULT_PRESET;
    setHidden(advancedEl, true);
  }

  // A readout such as "on" or "ladder" is words too: write every one again in
  // the new language, without touching the value it reports.
  onLanguageChange(() => {
    for (const def of Object.values(KNOBS)) {
      const out = document.getElementById(def.id + 'v');
      if (out && def.id in liveValues) out.textContent = formatKnob(def, liveValues[def.id], ctx());
    }
    refreshChainReadout();
  });

  return {
    activePreset: () => (isCustom(selected) ? null : selected),
    choice: () => selected,
    choose,
  };
}
