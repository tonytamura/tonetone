/**
 * The options a player keeps between visits: which preset they play, what
 * each Custom slot holds, and the everyday settings.
 *
 * The panel shows the preset picker and the everyday settings to everyone.
 * Every other knob belongs to the Custom slots: shown, and remembered, only
 * there. There are three, each a game of the player's own, and each starts
 * from the registry defaults the first time it is opened. A named preset is a
 * whole game — its own values for the knobs it declares and the registry
 * defaults for every other advanced knob — so nothing changed in a Custom slot
 * follows the player into Normal, or into another slot, unseen.
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
const VERSION = 2;

/** The Custom slots, in the picker's order after the registry presets. */
export const CUSTOM_SLOTS: { id: string; label: string }[] = [1, 2, 3].map(n => ({ id: `custom${n}`, label: `Custom ${n}` }));

export function isCustom(id: string): boolean {
  return CUSTOM_SLOTS.some(c => c.id === id);
}

/**
 * Shown whatever the preset, and kept as the player left them. Ball numbers is
 * the colour-blind option and must never hide behind Custom. The AI opponent —
 * the ladder, or one rung held fixed — is a choice about who to play, not about
 * the rules, so it stays put whichever preset is picked.
 */
export const EVERYDAY_KNOBS: KnobId[] = ['labels', 'vol', 'haptics', 'ailevel'];

/** Every other knob: the ones a Custom slot shows and remembers. */
export function advancedKnobs(): KnobId[] {
  return (Object.keys(KNOBS) as KnobId[]).filter(id => !EVERYDAY_KNOBS.includes(id));
}

/** The picker's choices, in order: the registry's presets, then the Custom slots. */
export function presetChoices(): { id: string; label: string }[] {
  return [...presetIds().map(id => ({ id, label: PRESETS[id].label })), ...CUSTOM_SLOTS];
}

/** What a named preset sets every advanced knob to; for a Custom slot, where it starts: the registry defaults. */
export function namedPresetValues(presetId: string): Record<string, KnobValue> {
  const own = isCustom(presetId) ? {} : presetKnobs(presetId);
  const out: Record<string, KnobValue> = {};
  for (const id of advancedKnobs()) out[id] = id in own ? own[id] : KNOBS[id].default;
  return out;
}

export interface SavedSettings {
  /** A preset id, or a Custom slot's. */
  preset: string;
  /** Each Custom slot's values, by slot id; a slot is absent until it has been opened. */
  customs: Record<string, Record<string, KnobValue>>;
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
    if (!p || (p.v !== VERSION && p.v !== 1)) return null;
    // Version 1 had a single Custom; it becomes the first slot.
    const stored: unknown = p.v === 1 ? { [CUSTOM_SLOTS[0].id]: p.custom } : p.customs;
    const wanted = p.v === 1 && p.preset === 'custom' ? CUSTOM_SLOTS[0].id : p.preset;
    const preset = presetChoices().some(c => c.id === wanted) ? wanted : presetIds()[0];
    const customs: Record<string, Record<string, KnobValue>> = {};
    if (stored && typeof stored === 'object') {
      for (const { id } of CUSTOM_SLOTS) {
        const slot = (stored as Record<string, unknown>)[id];
        if (slot && typeof slot === 'object') customs[id] = cleanValues(slot, advancedKnobs());
      }
    }
    return { preset, customs, player: cleanValues(p.player, EVERYDAY_KNOBS) };
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
