/**
 * The tunable-knob registry.
 *
 * Every knob the game exposes is defined once, here: its range, its default, how
 * it is applied, and how it reads back. The in-game tuning panel
 * (`ui/SettingsModal.ts`) binds DOM inputs to these definitions, and the
 * simulation harness drives the same definitions by name. A knob therefore
 * cannot mean one thing to a player dragging a slider and another to a
 * simulation measuring its effect.
 *
 * Knob ids match the `<input>` ids in `index.html`; `tests/sim/Knobs.test.ts`
 * asserts the markup's min/max/step/value still agree with the registry.
 */
import { t } from '../i18n/I18n';
import { Game } from '../game/GameState';
import { PhysicsConfig, chainPercent, recalcThresholds } from '../physics/Config';
import { inertiaOf } from '../physics/RigidBody';
import { COLORS, MAX_COLORS, MIN_COLORS, SHOT_DECAY, SPECIALS, WHITE_ODDS, colorOfKind, setColorsCount, setShotDecay, setSpecialsToggle, setWhiteOdds } from '../game/Rules';
import { AudioStore, applyDrone, applyGain, setLatencyHint } from '../audio/SynthEngine';
import { formatClock } from '../game/Clock';

import { AI_LEVELS } from '../game/AI';
import { FORCED_AI_LEVEL, setForcedAiLevel } from '../game/AIChoice';

export type KnobValue = number | string;

export interface KnobContext {
  game: Game;
  /** Field height, used by knobs that recompute scale-derived thresholds. */
  height: number;
}

/** What every knob carries, whatever kind it is. */
interface KnobCommon {
  /** Which panel section the knob belongs to. */
  group: 'game' | 'physics' | 'chain' | 'audio';
  /** Audio knobs need the AudioContext resumed before they mean anything. */
  wakesAudio?: boolean;
  /** True for knobs with no effect on simulation outcomes (visual/audio only). */
  cosmetic?: boolean;
  read(ctx: KnobContext): KnobValue;
}

/**
 * A slider. Its applier and its readout are handed a number, not `any`.
 *
 * `apply` and `format` used to take `any`, which was most of the explicit `any`s
 * left in `src`: a knob could quietly do string arithmetic on its own value and
 * nothing would say so.
 */
export interface RangeKnobSpec extends KnobCommon {
  kind: 'range';
  min: number;
  max: number;
  step: number;
  default: number;
  apply(value: number, ctx: KnobContext): void;
  format(value: number, ctx: KnobContext): string;
}

/**
 * A dropdown, typed by the options it declares.
 *
 * `O` is the union of its own option strings, so an applier cannot be handed a
 * value the knob does not offer, and adding an option to the list is what makes
 * the applier accept it.
 */
export interface SelectKnobSpec<O extends string = string> extends KnobCommon {
  kind: 'select';
  options: readonly O[];
  default: O;
  apply(value: O, ctx: KnobContext): void;
  format(value: O, ctx: KnobContext): string;
}

/** A knob as authored: everything but the `id`, which comes from the key. */
export type KnobSpec = RangeKnobSpec | SelectKnobSpec;

/** A knob as the registry serves it. */
export type KnobDef = KnobSpec & { id: string };

function pct(v: number): string {
  return Math.round(v * 100) + '%';
}

const KNOB_SPECS = {
  specials: {
    group: 'game', kind: 'range', min: 0, max: 1, step: 1, default: 1,
    apply: v => setSpecialsToggle(v > 0),
    format: v => (v > 0 ? t('fmt.on') : t('fmt.off')),
    read: () => (SPECIALS ? 1 : 0),
  },

  /**
   * How often the player who is behind draws a white.
   *
   * The value is white's share of the one special slot a draw rolls, so the
   * chance per draw is `white / (colours + 1)` — which is what `format` prints,
   * because the share on its own says nothing about how often a white is seen.
   * 0 turns white off without touching black; 1 gives it the whole slot, which
   * is 25% per draw at three colours and 14.3% at six.
   *
   * The default is 0.75 rather than the 0.5 the rule shipped with, because at
   * 0.5 one solo match in twelve produced no white at all. 1 is not the default:
   * it is the only value that broke a geometric invariant in testing (0.505px
   * of overlap against a 0.05px tolerance, 1 duel match in 60), and it buys no
   * measurable drop in zero-white matches over 0.75.
   */
  white: {
    group: 'game', kind: 'range', min: 0, max: 1, step: 0.05, default: 0.75,
    apply: v => setWhiteOdds(v),
    format: v => pct(v / (COLORS + 1)),
    read: () => WHITE_ODDS,
  },

  ailevel: {
    // 0 is the ladder; 1..N forces that rung, for feeling one level at a time.
    group: 'game', kind: 'range', min: 0, max: AI_LEVELS.length, step: 1, default: 0,
    apply: v => setForcedAiLevel(v),
    format: v => (v === 0 ? t('fmt.ladder') : AI_LEVELS[v - 1]?.label ?? String(v)),
    read: () => FORCED_AI_LEVEL,
  },

  colours: {
    group: 'game', kind: 'range', min: MIN_COLORS, max: MAX_COLORS, step: 1, default: 3,
    apply: (v, { game }) => {
      setColorsCount(v);
      for (const b of game.balls) {
        if (!b.special) {
          b.kind = b.kind % v;
          b.color = colorOfKind(b.kind);
        }
      }
      for (const g of game.groups) if (g.members.length > 1) g.color = colorOfKind(g.members[0].kind);
      for (const p of game.players) {
        for (const slot of ['loaded', 'nextUp', 'then'] as const) {
          if (p[slot] && !p[slot]!.special) {
            p[slot]!.kind = p[slot]!.kind % v;
            p[slot]!.color = colorOfKind(p[slot]!.kind);
          }
        }
      }
    },
    format: v => String(v),
    read: () => COLORS,
  },

  labels: {
    group: 'game', kind: 'range', min: 0, max: 1, step: 1, default: 0, cosmetic: true,
    apply: (v, { game }) => { game.showLabels = v > 0; },
    format: v => (v > 0 ? t('fmt.on') : t('fmt.off')),
    read: ({ game }) => (game.showLabels ? 1 : 0),
  },

  stats: {
    group: 'game', kind: 'range', min: 0, max: 1, step: 1, default: 0, cosmetic: true,
    apply: (v, { game }) => { game.showStats = v > 0; },
    format: v => (v > 0 ? t('fmt.on') : t('fmt.off')),
    read: ({ game }) => (game.showStats ? 1 : 0),
  },

  match: {
    // 1:00 to 20:00 in half-minute steps. 0 is off the slider but still a legal
    // value: the harness sets `matchLen = 0` for an unwindowed run, so `format`
    // still has to name it.
    group: 'game', kind: 'range', min: 60, max: 1200, step: 30, default: 120,
    apply: (v, { game }) => { game.matchLen = v; },
    format: v => (v === 0 ? t('fmt.endless') : formatClock(v)),
    read: ({ game }) => game.matchLen,
  },

  size: {
    group: 'game', kind: 'range', min: 8, max: 26, step: 1, default: 12,
    apply: (v, { game }) => {
      PhysicsConfig.R = v;
      // Every group's inertia is derived from the ball radius, so it has to be
      // rebuilt here — through the same function that first computed it.
      for (const g of game.groups) g.inertia = inertiaOf(g.offsets);
    },
    format: () => String(Math.round(PhysicsConfig.R)),
    read: () => PhysicsConfig.R,
  },

  rain: {
    group: 'game', kind: 'range', min: 0, max: 10, step: 0.5, default: 0,
    apply: (v, { game }) => { game.rainInterval = v; },
    format: v => (v === 0 ? t('fmt.auto') : v.toFixed(1) + 's'),
    read: ({ game }) => game.rainInterval,
  },

  shotdecay: {
    // Each further scoring event from one throw pays this fraction of the last.
    group: 'game', kind: 'range', min: 0.3, max: 1, step: 0.05, default: 0.5,
    apply: v => setShotDecay(v),
    format: v => (v >= 1 ? t('fmt.noDecay') : '×' + v.toFixed(2)),
    read: () => SHOT_DECAY,
  },

  roll: {
    group: 'physics', kind: 'range', min: 0.15, max: 1, step: 0.01, default: 0.59,
    apply: v => { PhysicsConfig.DRAG = v; },
    format: v => (v >= 0.999 ? t('fmt.none') : Math.round(Math.log(500 / PhysicsConfig.STOP) / Math.log(1 / v)) + 's'),
    read: () => PhysicsConfig.DRAG,
  },

  bounce: {
    group: 'physics', kind: 'range', min: 0.5, max: 1, step: 0.01, default: 1,
    apply: v => { PhysicsConfig.REST = v; PhysicsConfig.REST_WALL = v * 0.8; },
    format: v => pct(v),
    read: () => PhysicsConfig.REST,
  },

  spin: {
    group: 'physics', kind: 'range', min: 0, max: 1, step: 0.05, default: 1,
    apply: v => { PhysicsConfig.SPIN = v; },
    format: v => pct(v),
    read: () => PhysicsConfig.SPIN,
  },

  kick: {
    group: 'physics', kind: 'range', min: 0.2, max: 2.5, step: 0.05, default: 1.2,
    apply: v => { PhysicsConfig.KICK = v; },
    format: v => v.toFixed(1) + '×',
    read: () => PhysicsConfig.KICK,
  },

  reload: {
    group: 'physics', kind: 'range', min: 0, max: 8, step: 0.5, default: 3,
    apply: (v, { game }) => { game.reloadTime = v; },
    format: v => (v === 0 ? t('fmt.off') : v.toFixed(1) + 's'),
    read: ({ game }) => game.reloadTime,
  },

  boom: {
    group: 'chain', kind: 'range', min: 0.2, max: 1, step: 0.05, default: 0.4,
    apply: (v, { height }) => { PhysicsConfig.BOOM_AT = v; recalcThresholds(height); },
    format: v => pct(v),
    read: () => PhysicsConfig.BOOM_AT,
  },

  maxpower: {
    group: 'chain', kind: 'range', min: 600, max: 2000, step: 50, default: 1600,
    apply: (v, { height }) => { PhysicsConfig.THROW_MAX = v; recalcThresholds(height); },
    format: v => String(v),
    read: () => PhysicsConfig.THROW_MAX,
  },

  kickout: {
    group: 'chain', kind: 'range', min: 0.3, max: 1.2, step: 0.05, default: 0.5,
    apply: (v, { height }) => { PhysicsConfig.KICKOUT_FRAC = v; recalcThresholds(height); },
    format: v => Math.round(v * 100) + '% /' + chainPercent() + '%',
    read: () => PhysicsConfig.KICKOUT_FRAC,
  },

  spread: {
    group: 'chain', kind: 'range', min: 0.5, max: 2, step: 0.05, default: 2,
    apply: v => { PhysicsConfig.GHOST_SPREAD_HI = v; },
    format: v => v.toFixed(2) + '×',
    read: () => PhysicsConfig.GHOST_SPREAD_HI,
  },

  speedcap: {
    group: 'chain', kind: 'range', min: 600, max: 3600, step: 100, default: 3200,
    apply: v => { PhysicsConfig.SPEED_CAP = v; },
    format: v => v + ' px/s',
    read: () => PhysicsConfig.SPEED_CAP,
  },

  minboom: {
    group: 'chain', kind: 'range', min: 1, max: 6, step: 1, default: 2,
    apply: v => { PhysicsConfig.MIN_BOOM = v; },
    format: v => (v <= 1 ? t('fmt.any') : v + '+'),
    read: () => PhysicsConfig.MIN_BOOM,
  },

  /**
   * How bright the black magnet lock is: a pitch multiplier on its arc, the
   * arc's filters and its noise sizzle, leaving the suction sub alone. Turning
   * it down therefore moves the voice onto the sub rather than only dulling it.
   *
   * 1 is where the lock shipped, with the arc from 2.4 kHz and the lowpass
   * resonance at 5.2 kHz — doubled again for a black-on-black pair, which put
   * that pair's resonance at 10 kHz. The whole family read as shrill; 0.6 was
   * tried first and still read as too bright, and 0.3 is the value chosen by
   * ear. The range reaches below it to 0.15 so the default is not sitting on
   * the slider's end stop. Like `boomcut`, it is a knob because the value that
   * stops being irritating depends on the speaker.
   */
  locktone: {
    group: 'audio', kind: 'range', min: 0.15, max: 1.5, step: 0.05, default: 0.3,
    wakesAudio: true, cosmetic: true,
    apply: v => { AudioStore.lockTone = v as number; },
    format: v => Math.round(2400 * (v as number)) + 'Hz arc',
    read: () => AudioStore.lockTone,
  },

  boomcut: {
    group: 'audio', kind: 'range', min: 40, max: 600, step: 5, default: 300,
    wakesAudio: true, cosmetic: true,
    apply: v => { AudioStore.boomCut = v as number; },
    format: v => Math.round(v as number) + 'Hz',
    read: () => AudioStore.boomCut,
  },

  latency: {
    group: 'audio', kind: 'range', min: 0, max: 0.2, step: 0.01, default: 0.05,
    wakesAudio: true, cosmetic: true,
    apply: v => { setLatencyHint(v as number); },
    format: v => (v ? Math.round((v as number) * 1000) + 'ms' : t('fmt.auto')),
    read: () => AudioStore.latency,
  },

  haptics: {
    group: 'audio', kind: 'range', min: 0, max: 1, step: 1, default: 1, cosmetic: true,
    apply: v => { AudioStore.haptics = v as number; },
    format: v => (v ? t('fmt.on') : t('fmt.off')),
    read: () => AudioStore.haptics,
  },

  vol: {
    group: 'audio', kind: 'range', min: 0, max: 2, step: 0.05, default: 0.9, wakesAudio: true, cosmetic: true,
    apply: v => { AudioStore.volume = v; applyGain(); },
    format: v => pct(v),
    read: () => AudioStore.volume,
  },

  lock: {
    group: 'audio', kind: 'range', min: 0, max: 2, step: 0.05, default: 1, wakesAudio: true, cosmetic: true,
    apply: v => { AudioStore.lockVol = v; },
    format: v => pct(v),
    read: () => AudioStore.lockVol,
  },

  brk: {
    group: 'audio', kind: 'range', min: 0, max: 2, step: 0.05, default: 1.7, wakesAudio: true, cosmetic: true,
    apply: v => { AudioStore.breakVol = v; },
    format: v => pct(v),
    read: () => AudioStore.breakVol,
  },

  boomvol: {
    group: 'audio', kind: 'range', min: 0, max: 2, step: 0.05, default: 1, wakesAudio: true, cosmetic: true,
    apply: v => { AudioStore.boomVol = v; },
    format: v => pct(v),
    read: () => AudioStore.boomVol,
  },

  clicks: {
    group: 'audio', kind: 'range', min: 0, max: 2, step: 0.05, default: 0.5, wakesAudio: true, cosmetic: true,
    apply: v => { AudioStore.clickVol = v; },
    format: v => pct(v),
    read: () => AudioStore.clickVol,
  },

  drone: {
    group: 'audio', kind: 'range', min: 0, max: 1, step: 0.05, default: 0.25, wakesAudio: true, cosmetic: true,
    apply: v => { AudioStore.drone = v; applyDrone(); },
    format: v => (v === 0 ? t('fmt.off') : pct(v)),
    read: () => AudioStore.drone,
  },
} satisfies Record<string, KnobSpec>;
/**
 * A knob's id, for code that names one. Derived from the registry, so a knob that
 * does not exist is a type error rather than a silent no-op at run time.
 */
export type KnobId = keyof typeof KNOB_SPECS;

/**
 * The registry, with each knob's `id` filled in from the key it is declared
 * under.
 *
 * The id used to be written out a second time inside each definition, with
 * nothing checking that the two agreed: renaming only one of them would have left
 * a knob whose id no longer matched the key it was looked up by, and whose
 * `<input>` in index.html then bound to nothing. There is now one spelling.
 */
export const KNOBS: Record<KnobId, KnobDef> = (() => {
  const out = {} as Record<KnobId, KnobDef>;
  for (const id of Object.keys(KNOB_SPECS) as KnobId[]) {
    out[id] = { ...KNOB_SPECS[id], id };
  }
  return out;
})();

/**
 * True when a string names a knob, narrowing it so `KNOBS` can be indexed.
 *
 * `KNOBS` is keyed by `KnobId` rather than by `string`, so `KNOBS.kickout` is
 * checked and a misspelling is a compile error. An id arriving from a command
 * line or a settings paste is only a `string` until it has been through here.
 */
export function isKnobId(id: string): id is KnobId {
  return Object.prototype.hasOwnProperty.call(KNOBS, id);
}

/** The knob a string names, or `undefined` if it names none. */
export function knobById(id: string): KnobDef | undefined {
  return isKnobId(id) ? KNOBS[id] : undefined;
}

/**
 * The presets, declared once for both consumers.
 *
 * A preset is a set of *differences* from the registry defaults, not a full
 * snapshot. `normal` therefore holds nothing at all: it is the shipped default,
 * and selecting it means "put the knobs I touch back where they started". Every
 * value here is measured rather than asserted — see the "Screen Shapes and the
 * Presets" study in Notion for the boom rates, group survival and playability
 * guards each one produces.
 *
 * The three added presets are each anchored on one quality the original three
 * did not deliver — chain depth, table density, and matches that change hands —
 * and all three run at six colours, which costs only mean boom size (3.47 to
 * 2.88) and nothing else measurable.
 *
 * Only gameplay knobs appear. Picking a preset must not move a player's volume
 * or their colour-blind ball shapes, so the audio and cosmetic knobs are
 * deliberately outside every preset, and `PRESET_SPAN` below is exactly the set
 * of knobs a preset is allowed to touch.
 */
export interface PresetDef {
  id: string;
  /** The name the panel shows, and the `<option>` text in `index.html`. */
  label: string;
  /** Knob values that differ from the registry default. */
  knobs: Record<string, KnobValue>;
}

export const PRESETS: Record<string, PresetDef> = {
  normal: { id: 'normal', label: 'Normal', knobs: {} },

  relax: {
    id: 'relax', label: 'Relax',
    knobs: {
      match: 180, reload: 4.5, roll: 0.45, bounce: 0.88, kick: 1, boom: 0.55,
      minboom: 3, spread: 1.2, kickout: 0.4, maxpower: 1400, speedcap: 2600,
      size: 14, shotdecay: 0.7,
    },
  },

  chaos: {
    id: 'chaos', label: 'Chaos',
    knobs: {
      // One minute. Chaos throws at 1.5s and scores roughly 2.4x Normal per
      // second, so a two-minute match had already said everything it had to say
      // by the halfway mark; the short clock is what keeps it a sprint.
      match: 60,
      reload: 1.5, roll: 0.75, boom: 0.3, kickout: 0.8, maxpower: 1500, speedcap: 3600,
    },
  },

  /**
   * Cascade — one throw, many consequences.
   *
   * Built on chain depth: `minboom` 3 spares pairs, so the field keeps enough
   * standing groups for a boom's debris to reach a second and a third; the
   * larger ball and the longer roll carry that debris far enough to arrive; and
   * the slower reload lets a cascade finish before the next throw lands on top
   * of it. Measured over 40 seeds at 120s duel: 38% of throws reach eight
   * scoring events, against 9% under Normal, at 12.5 booms a minute rather than
   * Normal's 17.9. The trade is deliberate — fewer, longer events.
   *
   * `shotdecay` stays at its default on purpose. Raising it pays the late
   * events of a long chain more, but those are mostly incidental debris
   * contacts: at 0.85 the boom's share of the score *falls* from 37% to 25%,
   * which rewards a ball wandering the table rather than the cascade itself.
   */
  cascade: {
    id: 'cascade', label: 'Cascade',
    knobs: {
      match: 180, colours: 6, minboom: 3, size: 15, roll: 0.75, reload: 3.5, boom: 0.5,
    },
  },

  /**
   * Drift — a full, slow table.
   *
   * The gentle throw and the low speed cap mean balls arrive slowly and stay,
   * so the field settles at 33 live balls against Normal's 17, and never once
   * drops below the density line that triggers auto rain (0% of frames starved,
   * against 13% under Normal and 27% under Chaos). Chains are long for the same
   * reason — there is always something in the way — but booms are rare at 9.6 a
   * minute, so the match clock is the longest of any preset.
   */
  drift: {
    id: 'drift', label: 'Drift',
    knobs: {
      match: 240, colours: 6, kick: 0.6, speedcap: 1800, minboom: 3,
    },
  },

  /**
   * Rally — close matches that keep turning over.
   *
   * The quick reload puts roughly twice Normal's throws into a match, and
   * `minboom` 3 keeps the table stocked while they land, so neither player runs
   * out of material to play against. It changes hands 15.4 times a match to
   * Normal's 9.2, and the half-time trailer recovers 102 ±25 points by the end
   * — the only preset whose rubber banding clears twice its own standard error.
   * It is what Chaos reaches for, without Chaos stripping the table bare: Chaos
   * spends 27% of its match below the density line, Rally 5%.
   */
  rally: {
    id: 'rally', label: 'Rally',
    knobs: {
      match: 120, colours: 6, reload: 2, minboom: 3, bounce: 0.9, boom: 0.45,
    },
  },
};

/** The preset a fresh page load is in: the registry defaults themselves. */
export const DEFAULT_PRESET = 'normal';

export function presetIds(): string[] {
  return Object.keys(PRESETS);
}

/**
 * Every knob any preset touches.
 *
 * Switching presets has to *undo* the previous one, so it is not enough to apply
 * the incoming preset's own keys: a knob relax moves and chaos does not must go
 * back to its default when chaos is picked, or the two presets would bleed into
 * each other in whichever order the player tried them.
 */
export const PRESET_SPAN: KnobId[] = (Object.keys(KNOBS) as KnobId[]).filter(id =>
  Object.values(PRESETS).some(p => id in p.knobs)
);

/** The value a preset gives a knob: its own override, or the registry default. */
export function presetValue(presetId: string, knobId: string): KnobValue {
  const preset = PRESETS[presetId];
  if (!preset) throw new Error(`Unknown preset "${presetId}". Known presets: ${presetIds().join(', ')}`);
  const def = knobById(knobId);
  if (!def) throw new Error(`Unknown knob "${knobId}". Known knobs: ${knobIds().join(', ')}`);
  return knobId in preset.knobs ? preset.knobs[knobId] : def.default;
}

/** Every knob value a preset implies, across the whole span. */
export function presetKnobs(presetId: string): Record<string, KnobValue> {
  const out: Record<string, KnobValue> = {};
  for (const id of PRESET_SPAN) out[id] = presetValue(presetId, id);
  return out;
}

/** Apply a preset to the live config. Knobs outside the span are left alone. */
export function applyPreset(presetId: string, ctx: KnobContext): void {
  applyKnobs(presetKnobs(presetId), ctx);
}

/**
 * Which preset the live values match, or null if the player has moved something.
 *
 * The panel used this to say "modified"; since 2026-09-28 it has a Custom
 * choice instead (src/ui/PlayerSettings.ts), and this answers the same question
 * for the harness and the tests.
 */
export function presetMatching(values: Record<string, KnobValue>): string | null {
  for (const id of presetIds()) {
    const wanted = presetKnobs(id);
    if (PRESET_SPAN.every(k => values[k] === wanted[k])) return id;
  }
  return null;
}

export function knobIds(): KnobId[] {
  return Object.keys(KNOBS) as KnobId[];
}

/**
 * Coerce a knob value written on a command line ("0.6", "Hirajoshi") into the
 * type the knob expects, and reject values outside the slider's range — an
 * out-of-range knob measures a game no player can reach.
 */
export function parseKnobValue(id: string, raw: string): KnobValue {
  const def = knobById(id);
  if (!def) throw new Error(`Unknown knob "${id}". Known knobs: ${knobIds().join(', ')}`);
  if (def.kind === 'select') {
    if (!def.options.includes(raw)) {
      throw new Error(`Knob "${id}" must be one of: ${def.options.join(', ')}`);
    }
    return raw;
  }
  // `Number`, not `parseFloat`: parseFloat stops at the first character it cannot
  // read and returns what it got, so "0.55abc" parsed as 0.55 and a pasted
  // settings line like "boom=0.55 kick=1" silently became boom=0.55 with the rest
  // discarded — a run that reported success while ignoring most of its input.
  const v = Number(raw.trim());
  if (raw.trim() === '' || !isFinite(v)) throw new Error(`Knob "${id}" needs a number, got "${raw}"`);
  if (v < def.min) throw new Error(`Knob "${id}" is below its minimum ${def.min}`);
  if (v > def.max) throw new Error(`Knob "${id}" is above its maximum ${def.max}`);
  return v;
}

/**
 * Hand a value to a knob whose kind is not known where the call is written.
 *
 * A value arriving from a DOM input, a command line or a preset table is a
 * `KnobValue`, and a `KnobDef` is a union; the coercion between them has to
 * happen somewhere. It happens here, once, rather than being hidden by an `any`
 * on every applier. Both coercions are no-ops in practice — `parseKnobValue`
 * already returns a number for a range knob and a string for a select — and
 * doing them in one place is what lets the appliers be typed at all.
 */
export function applyKnob(def: KnobDef, value: KnobValue, ctx: KnobContext): void {
  if (def.kind === 'select') def.apply(String(value), ctx);
  else def.apply(Number(value), ctx);
}

/** Format a value for a knob whose kind is not known where the call is written. */
export function formatKnob(def: KnobDef, value: KnobValue, ctx: KnobContext): string {
  return def.kind === 'select' ? def.format(String(value), ctx) : def.format(Number(value), ctx);
}

/** Apply a set of knob values by id. Unknown ids throw rather than pass silently. */
export function applyKnobs(values: Record<string, KnobValue>, ctx: KnobContext): void {
  for (const [id, value] of Object.entries(values)) {
    const def = knobById(id);
    if (!def) throw new Error(`Unknown knob "${id}". Known knobs: ${knobIds().join(', ')}`);
    applyKnob(def, value, ctx);
  }
}

/** Apply every knob's documented default — the state a fresh page load produces. */
export function applyKnobDefaults(ctx: KnobContext): void {
  for (const def of Object.values(KNOBS)) applyKnob(def, def.default, ctx);
}

/** Read back the live value of every knob. */
export function readKnobs(ctx: KnobContext): Record<string, KnobValue> {
  const out: Record<string, KnobValue> = {};
  for (const [id, def] of Object.entries(KNOBS)) out[id] = def.read(ctx);
  return out;
}

/**
 * Module-level config is shared mutable state, so any harness run that tunes a
 * knob must put it back. Snapshot/restore covers PhysicsConfig wholesale, plus
 * the Rules and AudioStore fields knobs reach into.
 */
export interface ConfigSnapshot {
  physics: typeof PhysicsConfig;
  colors: number;
  specials: boolean;
  whiteOdds: number;
  forcedAi: number;
  shotDecay: number;
  audio: { volume: number; lockVol: number; breakVol: number; boomVol: number; clickVol: number; drone: number; haptics: number; latency: number; boomCut: number; lockTone: number };
}

export function snapshotConfig(): ConfigSnapshot {
  return {
    physics: { ...PhysicsConfig },
    colors: COLORS,
    specials: SPECIALS,
    whiteOdds: WHITE_ODDS,
    forcedAi: FORCED_AI_LEVEL,
    shotDecay: SHOT_DECAY,
    audio: {
      volume: AudioStore.volume, lockVol: AudioStore.lockVol, breakVol: AudioStore.breakVol,
      boomVol: AudioStore.boomVol, clickVol: AudioStore.clickVol, drone: AudioStore.drone,
      haptics: AudioStore.haptics, latency: AudioStore.latency, boomCut: AudioStore.boomCut,
      lockTone: AudioStore.lockTone,
    },
  };
}

export function restoreConfig(snap: ConfigSnapshot): void {
  Object.assign(PhysicsConfig, snap.physics);
  setColorsCount(snap.colors);
  setSpecialsToggle(snap.specials);
  setWhiteOdds(snap.whiteOdds);
  setForcedAiLevel(snap.forcedAi);
  setShotDecay(snap.shotDecay);
  Object.assign(AudioStore, snap.audio);
}
