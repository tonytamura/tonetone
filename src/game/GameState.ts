import { Ball, Flash, Group, LauncherPlayer, Pop } from '../physics/Types';
import { PhysicsConfig } from '../physics/Config';
import { BANK_MAX, FIRE_ON_RELEASE, drawFor, randomKind, colorOfKind } from './Rules';
import { BLACK_HEX, WHITE_HEX } from '../graphics/Palette';
import { rebuildGroups } from '../physics/RigidBody';
import { aimDirOf, launchPointOf, throwSpeedOf } from '../physics/LauncherBays';
import { playSwoosh } from '../audio/Voices';
import { panOf } from '../audio/SoundEvents';
import { CollisionState, RAIN_BLINK, RAIN_GRACE } from '../physics/CollisionSolver';
import { TAU } from '../math';
import { CLASSIC_LEVEL } from './AI';

/**
 * How the seats are filled for a match.
 *
 * The menu used to hand `main.ts` a bare number (1 solo, 2 duel, 3 vs AI) while
 * the harness named the same three arrangements in strings, so the two halves of
 * the codebase described one concept twice and neither name reached the other.
 * This is the shared name; the harness's `Mode` adds `idle`, which has no menu
 * entry because nobody throws in it.
 */
export type PlayMode = 'solo' | 'duel' | 'ai';

export function makeLauncher(side: number): LauncherPlayer {
  return {
    side,
    aimDeg: 0,
    strength: 0.55,
    loaded: null,
    nextUp: null,
    then: null,
    reload: 0,
    bank: BANK_MAX,
    releases: 0,
    hold: 0,
    lastThrowAt: -Infinity,
    destroyed: 0,
    booms: 0,
    locks: 0,
    peels: 0,
    score: 0,
    best: 0,
    lockPts: 0,
    boomPts: 0,
    peelPts: 0,
  };
}

export interface Game {
  balls: Ball[];
  groups: Group[];
  flashes: Flash[];
  pops: Pop[];
  byId: Map<number, Ball>;
  lastHit: Map<string, number>;
  players: LauncherPlayer[];
  nextId: number;
  twoPlayer: boolean;
  aiOn: boolean;
  /**
   * Which rung of the AI ladder plays player 2 when `aiOn` (see `AI_LEVELS`),
   * or `CLASSIC_LEVEL` (-1) for the pre-ladder AI, which the harness plays.
   */
  aiLevel: number;
  /** Shapes on the balls: 0 automatic (from `AUTO_MARK_COLORS`), 1 always, 2 never. */
  marks: number;
  /**
   * Launchers driven by the harness rather than a finger. Under continuous fire
   * they release by themselves (`BOT_RELEASE_GAP`), as the AI's launcher does.
   */
  bots: [boolean, boolean];
  showStats: boolean;
  matchLen: number;
  matchT: number;
  matchRunning: boolean;
  matchOver: boolean;
  paused: boolean;
  reloadTime: number;
  rainInterval: number;
  rainTimer: number;
  /**
   * Whether the auto rain is on: it starts below the density threshold and
   * stops only above 1.25x it (`isLowBallDensity`). Cleared by `resetField`.
   */
  raining: boolean;
  /**
   * The simulation clock the solver last stepped to: what `lastHit`'s pair
   * cooldowns are measured on. Kept by `advanceFrame`, read by the planner.
   */
  clock: number;
  killBig: number;
  killGroups: number;
  killBalls: number;
}

export function getRainBallAlpha(rainTime?: number): number {
  if (rainTime === undefined || rainTime <= 0) return 1.0;
  const elapsed = RAIN_GRACE - Math.min(RAIN_GRACE, rainTime);
  // One full pulse per blink, so a ball held back for another blink keeps pulsing
  // without a jump.
  const cycle = (elapsed / RAIN_BLINK) * TAU;
  const alpha = 0.5 * (1 - Math.cos(cycle));
  return Math.max(0, Math.min(0.9, alpha));
}

export function createGame(): Game {
  const players = [makeLauncher(1), makeLauncher(-1)];
  return {
    balls: [],
    groups: [],
    flashes: [],
    pops: [],
    byId: new Map(),
    lastHit: new Map(),
    players,
    nextId: 1,
    twoPlayer: false,
    aiOn: false,
    aiLevel: CLASSIC_LEVEL,
    marks: 0,
    bots: [false, false],
    showStats: false,
    matchLen: 120,
    matchT: 0,
    matchRunning: false,
    matchOver: false,
    paused: false,
    reloadTime: 3,
    rainInterval: 0,
    rainTimer: 0,
    raining: false,
    clock: 0,
    killBig: 0,
    killGroups: 0,
    killBalls: 0,
  };
}

/**
 * Put a freshly reset field into a running match.
 *
 * `countdown` is how long every launcher is held shut before it may fire. The
 * browser passes `game.reloadTime`, so nothing fires until the start countdown
 * finishes; the harness passes 0 and fires on the first frame. That difference
 * was previously written out separately in `main.newMatch` and `runSim`, where
 * neither caller said what the other did. It is one argument here so the two
 * cannot drift apart, and so the harness's shorter opening is visible in one
 * place rather than being an accident of which function was called.
 *
 * Call this after `resetField`, which clears the field and zeroes the tallies.
 */
export function startMatch(game: Game, countdown = 0) {
  game.matchT = 0;
  game.matchOver = false;
  for (const p of game.players) {
    // Continuous fire starts with a full bank and the ring at rest; the countdown
    // is held separately, since the ring now counts refills rather than throws.
    if (FIRE_ON_RELEASE) { p.reload = 0; p.bank = BANK_MAX; p.releases = 0; p.hold = countdown; }
    else p.reload = countdown;
  }
  game.matchRunning = true;
}

export function spawnBallGroup(game: Game, width: number, height: number) {
  const R = PhysicsConfig.R;
  const spacingX = R * 2.5;
  const spacingY = spacingX * (Math.sqrt(3) / 2);
  const rowCounts = [1, 2, 3, 4, 5, 4, 3, 2, 1];
  const numRows = rowCounts.length;
  const totalHeight = (numRows - 1) * spacingY;
  const centerY = height / 2;
  const topY = centerY - totalHeight / 2;
  const centerX = width / 2;

  for (let r = 0; r < numRows; r++) {
    const numBalls = rowCounts[r];
    const rowWidth = (numBalls - 1) * spacingX;
    const startX = centerX - rowWidth / 2;
    const y = topY + r * spacingY;

    for (let i = 0; i < numBalls; i++) {
      const x = startX + i * spacingX;
      const kind = randomKind();
      spawn(game, x, y, 0, 0, { dir: 0, speed: 0, kind, color: colorOfKind(kind), special: null }, width, height);
    }
  }
}

export function resetField(game: Game, width?: number, height?: number) {
  game.balls = [];
  game.groups = [];
  game.flashes = [];
  game.pops = [];
  game.lastHit.clear();
  game.byId.clear();
  game.paused = false;
  game.rainTimer = 0;
  game.raining = false;
  game.killBig = 0;
  game.killGroups = 0;
  game.killBalls = 0;

  // Every launcher starts the match as a new game makes it: the browser plays
  // match after match on one Game, and anything a launcher carried over — the
  // AI's working state (Bug 20), its aim, last match's scores — showed up in the
  // next one. The decks are drawn only once every score is back to zero: the
  // black and white odds read both players' scores, and drawing first dealt the
  // last match's winner a black on 39.5% of opening cards.
  for (const p of game.players) {
    for (const k of Object.keys(p)) if (k.startsWith('_')) delete (p as any)[k];
    delete p.holdFire;
    Object.assign(p, makeLauncher(p.side));
  }
  for (const p of game.players) {
    p.loaded = drawFor(p, game.players, game.twoPlayer);
    p.nextUp = drawFor(p, game.players, game.twoPlayer);
    p.then = drawFor(p, game.players, game.twoPlayer);
  }

  if (width && height) {
    spawnBallGroup(game, width, height);
  }
}

/**
 * How many live balls a field of this size wants before the rain stops.
 *
 * This is the game's own definition of "the table is getting empty", and it is
 * what the auto rain cadence is driven by. The harness reads the same function
 * to report how much of a match was spent starved, so a tuning preset cannot be
 * judged against a density rule the game does not actually use.
 */
export function lowDensityThreshold(width: number, height: number): number {
  return Math.max(14, Math.round((width * height) / 18000));
}

/** Live (non-ghost) balls on the field. Ghosts are debris, not playable material. */
export function liveBallCount(game: Game): number {
  let n = 0;
  for (const b of game.balls) if (!b.ghost) n++;
  return n;
}

export function isLowBallDensity(game: Game, width: number, height: number, stopThresholdMultiplier = 1.25): boolean {
  const activeCount = liveBallCount(game);
  const baseThreshold = lowDensityThreshold(width, height);
  const targetThreshold = game.raining ? Math.round(baseThreshold * stopThresholdMultiplier) : baseThreshold;
  game.raining = activeCount < targetThreshold;
  return game.raining;
}

export function spawnRainBall(game: Game, width: number, height: number): boolean {
  const R = PhysicsConfig.R;
  const pad = R + 4;
  const minX = pad;
  const maxX = width - pad;
  const minY = pad;
  const maxY = height - pad;
  if (maxX <= minX || maxY <= minY) return false;

  for (let attempt = 0; attempt < 30; attempt++) {
    const rx = minX + Math.random() * (maxX - minX);
    const ry = minY + Math.random() * (maxY - minY);
    if (spawn(game, rx, ry, 90, 240, null, width, height)) {
      const spawned = game.balls[game.balls.length - 1];
      if (spawned) spawned.rainTime = RAIN_GRACE;
      return true;
    }
  }
  return false;
}

export function fits(x: number, y: number, allowBay: boolean, game: Game, width: number, height: number): boolean {
  const R = PhysicsConfig.R;
  // Written as "not inside" so a NaN, which fails every comparison, fails here
  // too: `x < R || ...` let a NaN spot through as clear.
  if (!(x >= R && y >= R && x <= width - R && y <= height - R)) return false;
  if (!allowBay) {
    const keep = R * 2 + R;
    const activePlayers = game.twoPlayer ? game.players : [game.players[0]];
    for (const p of activePlayers) {
      const m = launchPointOf(p, width, height);
      const bx = x - m.x, by = y - m.y;
      if (bx * bx + by * by < keep * keep) return false;
    }
  }
  const need = Math.pow(2 * R + 0.5, 2);
  for (const b of game.balls) {
    const dx = b.x - x, dy = b.y - y;
    if (dx * dx + dy * dy < need) return false;
  }
  return true;
}

export function spawn(
  game: Game,
  x: number,
  y: number,
  lo: number,
  hi: number,
  aim: { dir: number; speed: number; kind: number; color: string; special: any; credit?: number } | null,
  width: number,
  height: number
): boolean {
  if (game.balls.length >= PhysicsConfig.MAX_BALLS) return false;
  if (!fits(x, y, !!aim, game, width, height)) {
    // Only an aimed spawn has someone to tell. A rain ball tries up to 30
    // random spots a tick, and flashing each miss drew phantom rings around
    // whatever ball happened to be in the way (about 3.4 a minute).
    if (aim) game.flashes.push({ x, y, t: 0, kind: 'blocked' });
    return false;
  }

  const ball: Ball = {
    id: game.nextId++,
    x,
    y,
    kind: aim ? aim.kind : randomKind(),
    special: aim ? aim.special || null : null,
    color: '',
    credit: aim && aim.credit !== undefined ? aim.credit : -1,
    shot: aim && aim.credit !== undefined && aim.credit >= 0 ? { events: 0 } : undefined,
    bonds: new Set(),
    group: null as any,
  };
  ball.color = ball.special ? (ball.special === 'black' ? BLACK_HEX : WHITE_HEX) : colorOfKind(ball.kind);
  if (aim) ball.exempt = 1.6;

  game.balls.push(ball);
  game.byId.set(ball.id, ball);

  const dir = aim ? aim.dir : Math.random() * TAU;
  const speed = (aim ? aim.speed : (lo + Math.random() * (hi - lo)) * PhysicsConfig.SC) * PhysicsConfig.KICK;
  // Both rebuilds are load-bearing, however redundant the first one looks: the
  // new ball has no bonds, so it is always the singleton the fallback below
  // describes. `rebuildGroups` is not idempotent — it re-derives every group's
  // velocity by averaging its members', which reintroduces rounding, and scales
  // `av` by the spin knob each time. Dropping this call moves scores by up to
  // 47% on a baseline scenario. Leave the pair alone.
  const g = rebuildGroups(game.balls, game.byId).find(group => group.members.includes(ball)) || {
    members: [ball],
    offsets: [{ x: 0, y: 0 }],
    com: { x, y },
    ang: 0,
    av: 0,
    vx: Math.cos(dir) * speed,
    vy: Math.sin(dir) * speed,
    mass: 1,
    inertia: 1,
    color: null,
  };

  g.vx = Math.cos(dir) * speed;
  g.vy = Math.sin(dir) * speed;
  ball.group = g;
  game.groups = rebuildGroups(game.balls, game.byId);
  game.flashes.push({ x, y, t: 0, kind: 'spawn' });
  return true;
}

export function launchSpot(p: LauncherPlayer, dir: number, game: Game, width: number, height: number) {
  const m = launchPointOf(p, width, height);
  const R = PhysicsConfig.R;
  for (let d = 0; d <= R * 6; d += R * 0.4) {
    const x = m.x + Math.cos(dir) * d, y = m.y + Math.sin(dir) * d;
    if (fits(x, y, true, game, width, height)) return { x, y };
  }
  return null;
}

/**
 * Launch player `p`'s loaded ball as aimed. `silent` launches it without the
 * swoosh: the planning AI throws imagined balls with this, on a copy of the
 * table, and every one of them used to be heard (Bug 15).
 */
export function throwBall(
  p: LauncherPlayer, game: Game, width: number, height: number, opts: { silent?: boolean } = {}
): boolean {
  if (p.reload > 0) return false;
  if (!launchBall(p, game, width, height, opts)) return false;
  p.reload = game.reloadTime;
  return true;
}

/**
 * Continuous fire: throw one ball from the bank, as aimed. A throw from a full
 * bank sets the ring going again; while the bank is short it is already going.
 * A blocked throw keeps its ball. `clock` is the simulation clock, for the
 * launchers that release by themselves.
 */
export function releaseBall(p: LauncherPlayer, game: Game, width: number, height: number, clock: number): boolean {
  if (p.bank <= 0 || p.hold > 0) return false;
  const wasFull = p.bank >= BANK_MAX;
  if (!launchBall(p, game, width, height)) return false;
  p.bank--;
  p.lastThrowAt = clock;
  if (wasFull) p.reload = game.reloadTime;
  return true;
}

/** Put `p`'s loaded ball on the field as aimed, and move the deck along. What paces it is the caller's. */
function launchBall(
  p: LauncherPlayer, game: Game, width: number, height: number, opts: { silent?: boolean } = {}
): boolean {
  if (!p.loaded) p.loaded = drawFor(p, game.players, game.twoPlayer);
  const isWhite = p.loaded.special === 'white';
  const dir = aimDirOf(p);
  const spot = launchSpot(p, dir, game, width, height);
  if (!spot) {
    const m = launchPointOf(p, width, height);
    game.flashes.push({ x: m.x, y: m.y, t: 0, kind: 'blocked' });
    return false;
  }
  const speed = throwSpeedOf(p, game.twoPlayer);
  const who = game.players.indexOf(p);

  if (
    !spawn(
      game,
      spot.x,
      spot.y,
      0,
      0,
      {
        dir,
        speed,
        kind: p.loaded.kind,
        color: p.loaded.color,
        special: p.loaded.special,
        credit: who,
      },
      width,
      height
    )
  )
    return false;

  p.loaded = p.nextUp || drawFor(p, game.players, game.twoPlayer);
  p.nextUp = p.then || drawFor(p, game.players, game.twoPlayer);
  p.then = drawFor(p, game.players, game.twoPlayer);

  if (!opts.silent) playSwoosh(panOf(spot.x, width), speed / (PhysicsConfig.THROW_MAX * 1.4), { isWhite });

  if (!game.matchRunning && !game.matchOver) {
    game.matchRunning = true;
    game.matchT = 0;
  }
  return true;
}

export function toCollisionState(game: Game): CollisionState {
  return {
    balls: game.balls,
    groups: game.groups,
    flashes: game.flashes,
    pops: game.pops,
    // Fresh each frame: sounds are drained by the frame loop, never carried over.
    sounds: [],
    byId: game.byId,
    lastHit: game.lastHit,
    players: game.players,
    // The same launchers `fits` keeps spawns away from: only the bottom one in solo.
    bays: game.twoPlayer ? game.players : [game.players[0]],
    nextId: game.nextId,
    killBig: game.killBig,
    killGroups: game.killGroups,
    killBalls: game.killBalls,
  };
}

export function syncFromCollisionState(game: Game, state: CollisionState) {
  game.balls = state.balls;
  game.groups = state.groups;
  game.flashes = state.flashes;
  game.pops = state.pops;
  game.nextId = state.nextId;
  game.killBig = state.killBig;
  game.killGroups = state.killGroups;
  game.killBalls = state.killBalls;
}
