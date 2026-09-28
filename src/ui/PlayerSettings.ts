/**
 * The options a player keeps between visits: which preset they play, what
 * Custom holds, and the everyday settings.
 *
 * The panel shows the preset picker and the everyday settings to everyone.
 * Every other knob belongs to Custom: it is shown, and remembered, only there.
 * A named preset is a whole game — its own values for the knobs it declares and
 * the registry defaults for every other advanced knob — so nothing changed in
 * Custom follows the player into Normal unseen.
 *
 * Stored as one versioned JSON value under `toneboom.settings`. Every value read
 * back is checked against the knob registry — clamped into range, snapped to its
 * step, an unknown knob or a bad type dropped — so a corrupt or stale entry can
 * never put a value into the physics that the sliders could not.
 *
 * The simulation harness never loads this, so a saved setting cannot move a
 * measurement.
 */
import { KNOBS, KnobDef, KnobId, KnobValue, PRESETS, presetIds, presetKnobs } from '../sim/Knobs';
import { KeyValueStore, deviceStore } from './Progress';

export const SETTINGS_KEY = 'toneboom.settings';
const VERSION = 1;

export const CUSTOM_ID = 'custom';
export const CUSTOM_LABEL = 'Custom';

/**
 * Shown whatever the preset, and kept as the player left them. Ball numbers is
 * the colour-blind option and must never hide behind Custom.
 */
export const EVERYDAY_KNOBS: KnobId[] = ['labels', 'vol', 'haptics'];

/** Every other knob: the ones Custom shows and remembers. */
export function advancedKnobs(): KnobId[] {
  return (Object.keys(KNOBS) as KnobId[]).filter(id => !EVERYDAY_KNOBS.includes(id));
}

/** The picker's choices, in order: the registry's presets, then Custom. */
export function presetChoices(): { id: string; label: string }[] {
  return [...presetIds().map(id => ({ id, label: PRESETS[id].label })), { id: CUSTOM_ID, label: CUSTOM_LABEL }];
}

/** What a named preset sets every advanced knob to. */
export function namedPresetValues(presetId: string): Record<string, KnobValue> {
  const own = presetKnobs(presetId);
  const out: Record<string, KnobValue> = {};
  for (const id of advancedKnobs()) out[id] = id in own ? own[id] : KNOBS[id].default;
  return out;
}

export interface SavedSettings {
  /** A preset id, or `custom`. */
  preset: string;
  /** Custom's values; empty until Custom has been used. */
  custom: Record<string, KnobValue>;
  /** The everyday settings. */
  player: Record<string, KnobValue>;
}

/** A value fit for knob `id`, or undefined if nothing sensible can be made of it. */
export function sanitize(id: string, v: unknown): KnobValue | undefined {
  const def = (KNOBS as Record<string, KnobDef | undefined>)[id];
  if (!def) return undefined;
  if (def.kind === 'select') {
    return typeof v === 'string' && def.options.includes(v) ? v : undefined;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const { min, max, step } = def;
  const clamped = Math.min(max, Math.max(min, v));
  // Snap to the slider's grid, in the step's own precision so 0.1 steps stay 0.1.
  const snapped = min + Math.round((clamped - min) / step) * step;
  const decimals = (String(step).split('.')[1] || '').length;
  return Math.min(max, Number(snapped.toFixed(decimals)));
}

function cleanValues(t: unknown, allowed: KnobId[]): Record<string, KnobValue> {
  const out: Record<string, KnobValue> = {};
  if (!t || typeof t !== 'object') return out;
  for (const [k, v] of Object.entries(t as Record<string, unknown>)) {
    if (!allowed.includes(k as KnobId)) continue;
    const ok = sanitize(k, v);
    if (ok !== undefined) out[k] = ok;
  }
  return out;
}

export function loadSettings(store: KeyValueStore | null = deviceStore()): SavedSettings | null {
  try {
    const raw = store?.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || p.v !== VERSION) return null;
    const preset = presetChoices().some(c => c.id === p.preset) ? p.preset : presetIds()[0];
    return {
      preset,
      custom: cleanValues(p.custom, advancedKnobs()),
      player: cleanValues(p.player, EVERYDAY_KNOBS),
    };
  } catch {
    return null;
  }
}

export function saveSettings(s: SavedSettings, store: KeyValueStore | null = deviceStore()): void {
  try {
    store?.setItem(SETTINGS_KEY, JSON.stringify({ v: VERSION, ...s }));
  } catch {
    // The settings last until the page closes; the game carries on.
  }
}
