import { Ball, Group, LauncherPlayer, Vector2D } from './Types';
import { PhysicsConfig } from './Config';
import { shiftGroup } from './RigidBody';

export function mouthRadius(): number {
  return PhysicsConfig.R * 2;
}

export function bayInset(): number {
  return mouthRadius() + PhysicsConfig.R + 2;
}

export function launchPointOf(p: LauncherPlayer, width: number, height: number): Vector2D {
  return p.side > 0
    ? { x: width / 2, y: height - bayInset() }
    : { x: width / 2, y: bayInset() };
}

export function aimDirOf(p: LauncherPlayer): number {
  return p.side > 0
    ? -Math.PI / 2 + (p.aimDeg * Math.PI) / 180
    : Math.PI / 2 + (p.aimDeg * Math.PI) / 180;
}

/**
 * The furthest the aim may reach, in any direction it can point: both how long
 * the arrow can be drawn and how far a drag goes for a full-strength throw.
 *
 * Both bays sit on the vertical centre line and sweep a half-disc of 180°, so
 * the envelope is round and the tighter of the two dimensions bounds it. A bound
 * taken from the height alone let a sideways aim run off the left or right edge
 * on any portrait screen, where `width / 2` is much the smaller of the two.
 *
 * The drag used to be scaled by the height instead (0.40 of it, 0.80 in solo),
 * which a drag can only reach going forward. Sideways there is only half the
 * width to drag in, so a touch at a bottom corner of a 412×915 phone threw at
 * 0.56 strength at best, and 0.28 in solo. On the round envelope a drag to the
 * edge of the player's area is full strength in every direction.
 */
export function aimMaxReach(width: number, height: number, twoPlayer: boolean): number {
  const forward = twoPlayer ? height / 2 - bayInset() : height - bayInset();
  const sideways = width / 2;
  return Math.max(38, Math.min(forward, sideways));
}

/**
 * How far past the finger the aim arrow's tip sits, in CSS px, so the finger
 * aiming never covers the arrow's head: a fingertip's reach past the touch
 * point (~25 px), the head's full length behind the tip (up to 29 px), and room
 * to see both. Tuned on Tony's phone, 2026-09-30: 48 left the head under the
 * finger, 100 (about 16 mm) put it too far ahead; 72 is about 12 mm.
 */
export const FINGER_CLEARANCE = 72;

/**
 * How long to draw the aim arrow: to where the finger is, plus
 * `FINGER_CLEARANCE`, so its head always shows ahead of the finger. The finger
 * sits at `strength` of the round limit (`aimAt`), so the arrow grows with power
 * over the whole range.
 *
 * It was 1.5 x the finger's distance, topping out at the round limit two thirds
 * of the way up the strength range; above that the finger reached the tip and
 * hid it, which continuous fire, where the finger stays down to aim each throw,
 * made plain (Tony, 2026-09-30).
 *
 * The tip is kept on the field along the aim: inside the screen, and in a duel
 * on the thrower's own half. Only a nearly flat throw at full power, with the
 * finger already at the screen's edge, has no room to spare.
 */
export function aimReachOf(p: LauncherPlayer, width: number, height: number, twoPlayer: boolean): number {
  const finger = Math.min(1, Math.max(0, p.strength)) * aimMaxReach(width, height, twoPlayer);
  return Math.min(Math.max(38, finger + FINGER_CLEARANCE), roomAlongAim(p, width, height, twoPlayer));
}

/** How far the aim arrow can run from the mouth before leaving the thrower's part of the field. */
function roomAlongAim(p: LauncherPlayer, width: number, height: number, twoPlayer: boolean): number {
  const m = launchPointOf(p, width, height);
  const dir = aimDirOf(p);
  const cx = Math.cos(dir), cy = Math.sin(dir);
  const yMin = p.side > 0 && twoPlayer ? height / 2 : 0;
  const yMax = p.side < 0 && twoPlayer ? height / 2 : height;
  let room = Infinity;
  if (cx > 1e-9) room = Math.min(room, (width - m.x) / cx);
  if (cx < -1e-9) room = Math.min(room, -m.x / cx);
  if (cy > 1e-9) room = Math.min(room, (yMax - m.y) / cy);
  if (cy < -1e-9) room = Math.min(room, (yMin - m.y) / cy);
  return room;
}

export function aimAt(p: LauncherPlayer, x: number, y: number, width: number, height: number, twoPlayer: boolean) {
  const m = launchPointOf(p, width, height);
  const dx = x - m.x, dy = y - m.y;
  const raw = p.side > 0 ? Math.atan2(dx, -dy) : Math.atan2(-dx, dy);
  p.aimDeg = Math.max(-90, Math.min(90, (raw * 180) / Math.PI));
  p.strength = Math.max(0, Math.min(1, Math.hypot(dx, dy) / aimMaxReach(width, height, twoPlayer)));
}

// `_twoPlayer` is deliberately ignored: throw power is mode-independent so that a
// single-player shot can still reach BOOM_SPEED. LauncherBays.test.ts pins
// speed1P === speed2P.
export function throwSpeedOf(p: LauncherPlayer, _twoPlayer?: boolean): number {
  const t = Math.pow(Math.max(0, p.strength), PhysicsConfig.POWER_CURVE);
  return (
    (PhysicsConfig.THROW_MIN + t * (PhysicsConfig.THROW_MAX - PhysicsConfig.THROW_MIN)) *
    PhysicsConfig.DUEL_POWER *
    PhysicsConfig.SC
  );
}

/**
 * The speed the ball actually leaves the bay at.
 *
 * `throwSpeedOf` is the aim's speed; `spawn` multiplies it by `KICK` on the way
 * out, so this is the number that has to be compared against `BOOM_SPEED`.
 * Comparing the unmultiplied one — which the old pink arrow cue did — answers a
 * question about a ball nobody throws, and is wrong by the size of the `kick`
 * knob in whichever direction it points.
 */
export function launchSpeedOf(p: LauncherPlayer, twoPlayer?: boolean): number {
  return throwSpeedOf(p, twoPlayer) * PhysicsConfig.KICK;
}

/** True when the throw as aimed would boom the group it hits. */
export function boomsOnImpact(p: LauncherPlayer, twoPlayer?: boolean): boolean {
  return launchSpeedOf(p, twoPlayer) >= PhysicsConfig.BOOM_SPEED;
}

/**
 * How far past the boom threshold a throw is: 0 the moment it starts booming,
 * 1 at the hardest throw the bay can make, and 0 for anything that will not
 * boom at all.
 *
 * This is the aim arrow's colour: `WHITE` at 0 and through the whole safe
 * range, reddening towards `AIM_HOT` as this climbs, pure red at 1. So the
 * arrow is white for as long as the throw cannot boom, and the ramp is spent
 * entirely on the throws a player is choosing between.
 *
 * **It was the other way round for a few hours on 2026-09-19**, ramping white
 * to red over the range *below* the threshold and holding red above it. That
 * put the whole colour change in the first third of the drag and left the top
 * two thirds — every throw that actually booms — at one flat red. Tony asked
 * for the opposite: white for as long as the throw will not boom, and the red
 * still climbing at maximum strength.
 *
 * Both ends move with the knobs, so both are read fresh each time: `boom` and
 * `maxpower` set `BOOM_SPEED`, `maxpower` and `kick` set the ceiling. If a knob
 * combination puts the threshold at or above the hardest throw, nothing booms
 * and the heat is 0 throughout — the arrow stays white, which is the truth
 * about that combination.
 */
export function boomHeatOf(p: LauncherPlayer, twoPlayer?: boolean): number {
  const ceiling = PhysicsConfig.THROW_MAX * PhysicsConfig.DUEL_POWER * PhysicsConfig.SC * PhysicsConfig.KICK;
  const span = ceiling - PhysicsConfig.BOOM_SPEED;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, (launchSpeedOf(p, twoPlayer) - PhysicsConfig.BOOM_SPEED) / span));
}

/**
 * Scratch for `mouthPenetration`, the scalar form of `mouthNormalAt`.
 *
 * The relax pass tests every member of every group against both bays on each of
 * its 24 iterations, so the small result object this used to allocate dominated
 * the cost of the test itself. Never read these without a `true` return.
 */
let penDeep = 0, penNx = 0, penNy = 0;

function mouthPenetration(b: Ball, mx: number, my: number, height: number): boolean {
  const dx = b.x - mx, dy = b.y - my;
  const d = Math.hypot(dx, dy);
  const pen = mouthRadius() + PhysicsConfig.R - d;
  if (pen <= 0) return false;
  penDeep = pen;
  if (d > 0.001) { penNx = dx / d; penNy = dy / d; }
  else { penNx = 0; penNy = -Math.sign(my - height / 2) || -1; }
  return true;
}

export function mouthNormalAt(b: Ball, m: Vector2D, height: number) {
  return mouthPenetration(b, m.x, m.y, height)
    ? { pen: penDeep, nx: penNx, ny: penNy }
    : null;
}

export function mouthClamp(g: Group, players: LauncherPlayer[], width: number, height: number) {
  const inset = bayInset();
  const mx = width / 2;
  for (const p of players) {
    const my = p.side > 0 ? height - inset : inset;
    let deep = 0, nx = 0, ny = 0;
    for (const b of g.members) {
      if (b.exempt) continue;
      if (mouthPenetration(b, mx, my, height) && penDeep > deep) {
        deep = penDeep; nx = penNx; ny = penNy;
      }
    }
    if (deep > 0) shiftGroup(g, nx * deep, ny * deep);
  }
}

export function mouthCollide(g: Group, players: LauncherPlayer[], width: number, height: number) {
  const inset = bayInset();
  const mx = width / 2;
  for (const p of players) {
    const my = p.side > 0 ? height - inset : inset;
    let deep = 0, hit: Ball | null = null, nx = 0, ny = 0;
    for (const b of g.members) {
      if (b.exempt) continue;
      if (mouthPenetration(b, mx, my, height) && penDeep > deep) {
        deep = penDeep; hit = b; nx = penNx; ny = penNy;
      }
    }
    if (!hit) continue;
    shiftGroup(g, nx * deep, ny * deep);
    const rx = hit.x - nx * PhysicsConfig.R - g.com.x, ry = hit.y - ny * PhysicsConfig.R - g.com.y;
    const vn = (g.vx - g.av * ry) * nx + (g.vy + g.av * rx) * ny;
    if (vn >= 0) continue;
    const rn = rx * ny - ry * nx;
    const invI = PhysicsConfig.SPIN / g.inertia;
    const j = (-(1 + PhysicsConfig.REST_WALL) * vn) / (1 / g.mass + rn * rn * invI);
    g.vx += (j * nx) / g.mass; g.vy += (j * ny) / g.mass;
    g.av += j * rn * invI;
  }
}

export function clearExempt(balls: Ball[], players: LauncherPlayer[], dt: number, width: number, height: number) {
  // The bay mouths do not move between balls, so resolve them once instead of
  // rebuilding a point per exempt ball per player.
  const inset = bayInset();
  const mx = width / 2;
  for (const b of balls) {
    if (!b.exempt) continue;
    b.exempt -= dt;
    let inside = false;
    for (const p of players) {
      if (mouthPenetration(b, mx, p.side > 0 ? height - inset : inset, height)) {
        inside = true;
        break;
      }
    }
    if (!inside || b.exempt <= 0) b.exempt = 0;
  }
}
