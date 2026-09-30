export interface Vector2D {
  x: number;
  y: number;
}

export type SpecialBallType = 'black' | 'white' | null;

/**
 * One throw's scoring tally. Every ball carrying credit from the same throw
 * shares this object, so each further event that throw causes pays less.
 */
export interface Shot {
  events: number;
}

export interface Ball {
  id: number;
  x: number;
  y: number;
  kind: number;
  special: SpecialBallType;
  color: string;
  credit: number;
  /** The throw `credit` came from. Copied wherever `credit` is copied. */
  shot?: Shot;
  bonds: Set<number>;
  group: Group;
  exempt?: number;
  rainTime?: number;
  ghost?: boolean;
  age?: number;
  pure?: boolean;
  _vx?: number;
  _vy?: number;
  _av?: number;
  _pg?: Group;
}

export interface Offset {
  x: number;
  y: number;
}

export interface Group {
  members: Ball[];
  offsets: Offset[];
  com: Vector2D;
  ang: number;
  av: number;
  vx: number;
  vy: number;
  mass: number;
  inertia: number;
  color: string | null;
  _x0?: number;
  _x1?: number;
  _y0?: number;
  _y1?: number;
}

/**
 * How long a flash lives, in seconds, and how long a scoring pop lives.
 *
 * These sit with the types they age because three separate systems age them: the
 * solver during a match, `main`'s results celebration, and the menu's own ambient
 * effects. Each used to carry its own copy of 0.85 and 1.1 — `FLASH_LIFE` existed
 * in `graphics/VisualFX` but the solver and `main` wrote the literal instead, so
 * the drift was already live. Declaring them here also means physics does not have
 * to import graphics to know them.
 */
export const FLASH_LIFE = 0.85;
export const POP_LIFE = 1.1;

/**
 * A sound the frame owes the player, recorded in world terms.
 *
 * The solver used to call the voices itself, which meant physics could not be
 * read or tested without the audio module loaded, and the stereo-pan and pitch
 * formulas were repeated at every call site. It now records what happened and
 * `audio/SoundEvents.playSoundEvents` turns that into sound once the frame's
 * substeps are done. `x` is a world coordinate; nothing here is an audio
 * parameter.
 */
export type SoundEvent =
  | { type: 'boom'; x: number; kind: number; size: number; whiteBlack: boolean }
  | { type: 'peel'; x: number; kind: number }
  | { type: 'knock'; x: number; force: number; hitterKind: number; struckKind: number }
  | { type: 'lock'; x: number; kind: number }
  | { type: 'magnetLock'; x: number; size: number; bothBlack: boolean };

export interface Flash {
  x: number;
  y: number;
  t: number;
  kind: 'bond' | 'break' | 'spawn' | 'blocked';
}

/** What a boom looked like, for the word its pop earns. */
export interface BoomShape {
  count: number;
  whiteBlack: boolean;
}

/**
 * What a pop says.
 *
 * A scoring pop carries the **facts** — the points it paid and, for a boom, its
 * shape — and the words are chosen where it is drawn. The solver used to build
 * the string itself, which put on-screen wording inside the physics and meant
 * `+96 SUPER BOOM!` was decided three layers below the canvas. This is the same
 * move `SoundEvent` already makes for sound: world facts out, presentation
 * elsewhere.
 *
 * The attract screen and the results celebration have no points to report, so
 * they carry their word directly.
 */
export type PopLabel =
  | { text: string }
  | { points: number; source?: ScoreSource; boom?: BoomShape };

/** Which counter a scoring event pays into. */
export type ScoreSource = 'lock' | 'boom' | 'peel';

export interface Pop {
  x: number;
  y: number;
  t: number;
  label: PopLabel;
  who: number;
  /** Size relative to the usual pop; the results celebration draws some bigger. */
  scale?: number;
}

export interface BallOnDeck {
  kind: number;
  color: string;
  special: SpecialBallType;
}

export interface LauncherPlayer {
  side: number; // 1 = bottom (P1), -1 = top (P2)
  aimDeg: number;
  strength: number;
  loaded: BallOnDeck | null;
  nextUp: BallOnDeck | null;
  then: BallOnDeck | null;
  reload: number;
  /** Continuous fire: balls ready to throw, 0 to `BANK_MAX`. The reload ring adds them. */
  bank: number;
  /** Continuous fire: releases of the finger waiting for the next frame to throw. */
  releases: number;
  /** Continuous fire: seconds before this launcher may throw, for the start countdown. */
  hold: number;
  /** The simulation clock at this launcher's last throw. */
  lastThrowAt: number;
  /** A planning AI still deciding its throw: under continuous fire it does not release yet. */
  holdFire?: boolean;
  destroyed: number;
  booms: number;
  locks: number;
  peels: number;
  score: number;
  best: number;
  lockPts: number;
  boomPts: number;
  peelPts: number;
  _idleDeg?: number;
}
