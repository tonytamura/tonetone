import { Game } from '../game/GameState';
import {
  DEFAULT_PRESET, KNOBS, KnobContext, KnobValue, PRESETS, PRESET_SPAN, applyKnob, formatKnob,
  presetIds, presetKnobs, presetMatching,
} from '../sim/Knobs';
import { initAudio } from '../audio/SynthEngine';

/**
 * Binds the tuning-panel DOM inputs to the shared knob registry in
 * `sim/Knobs.ts`. This file owns only the DOM: reading `<input>` values, writing
 * `<output>` labels, and waking the AudioContext. What a knob actually *does*
 * lives in the registry, which the simulation harness drives by the same names.
 */
import { renderSoundTester, updateSoundTesterReadouts } from './SoundTester';

export interface SettingsHandle {
  /** The preset the knobs currently add up to, or null when they match none. */
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
      reportPresetState();
    });
    run();
  }

  // --- Preset picker -------------------------------------------------------
  const presetEl = document.getElementById('preset') as HTMLSelectElement | null;
  const presetOut = document.getElementById('presetv');
  const idOfLabel = (label: string): string | undefined =>
    presetIds().find(id => PRESETS[id].label === label);

  /**
   * Say what the knobs currently add up to.
   *
   * A player who picks Chaos and then nudges one slider is no longer playing
   * Chaos, and a picker that kept claiming they were would be lying about the
   * game they are in. The select keeps its position — it is still the preset they
   * came from — and the readout says so.
   */
  function reportPresetState(): void {
    if (!presetOut) return;
    const match = presetMatching(liveValues);
    presetOut.textContent = match ? '' : 'modified';
  }

  if (presetEl) {
    const applySelected = () => {
      const id = idOfLabel(presetEl.value) ?? DEFAULT_PRESET;
      const values = presetKnobs(id);
      // Write the DOM first, then run each knob's own applier, so every slider,
      // readout and config field ends up where a hand-drag would have put them.
      for (const knobId of PRESET_SPAN) {
        const el = document.getElementById(knobId) as HTMLInputElement | HTMLSelectElement | null;
        if (!el) continue;
        el.value = String(values[knobId]);
        runners[knobId]?.();
      }
      reportPresetState();
    };

    presetEl.addEventListener('change', applySelected);
    // Do not apply on load: the markup already carries the default preset's
    // values, and applying here would overwrite a knob a test or a deep link had
    // set before the panel was wired.
    const current = presetMatching(liveValues) ?? DEFAULT_PRESET;
    presetEl.value = PRESETS[current].label;
  }

  reportPresetState();
  return { activePreset: () => presetMatching(liveValues) };
}
