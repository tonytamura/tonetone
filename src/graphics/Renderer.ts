import { Game, getRainBallAlpha } from '../game/GameState';
import { PhysicsConfig, recalcThresholds } from '../physics/Config';
import { uiFont } from './Fonts';
import { ballSprite, inkOn, SP_R, SPRITE } from './Sprites';
import { BG_SCALE, FIELD_RING, FLASH_SPECS, RESULTS_RING, drawLiquid, drawRippleRing } from './VisualFX';
import { AIM_HOT, BLACK_HEX, CYAN, FIELD_BG, MENU_CYAN, PINK, Rgb, VOID, WHITE, WHITE_HEX, hex, mix, rgba } from './Palette';
import { FLASH_LIFE, POP_LIFE } from '../physics/Types';
import { setHidden } from '../ui/Dom';
import { popText } from './PopText';
import { aimDirOf, aimReachOf, boomHeatOf, boomsOnImpact, launchPointOf, mouthRadius } from '../physics/LauncherBays';
import { LauncherPlayer } from '../physics/Types';
import { kindLabel } from '../game/Rules';
import { TAU } from '../math';

/** The player colours, indexed by player. */
export const P_RGB: Rgb[] = [CYAN, PINK];
export const P_COLOR: string[] = P_RGB.map(hex);

/** Ball labels are unreadable below this radius, so they are not drawn. */
export const MIN_LABEL_RADIUS = 11;

/** Clearance a score pop keeps from the left and right edges of the canvas. */
export const POP_EDGE_PAD = 6;

export interface RenderContext {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  bg: HTMLCanvasElement;
  bgx: CanvasRenderingContext2D;
  resCv: HTMLCanvasElement | null;
  resCtx: CanvasRenderingContext2D | null;
  W: number;
  H: number;
  bgW: number;
  bgH: number;
}

export function createRenderContext(canvas: HTMLCanvasElement): RenderContext {
  const ctx = canvas.getContext('2d')!;
  const bg = document.createElement('canvas');
  const bgx = bg.getContext('2d')!;
  const resCv = document.getElementById('resultsCanvas') as HTMLCanvasElement | null;
  const resCtx = resCv ? resCv.getContext('2d') : null;
  return {
    cv: canvas,
    ctx,
    bg,
    bgx,
    resCv,
    resCtx,
    W: 0,
    H: 0,
    bgW: 1,
    bgH: 1,
  };
}

/**
 * Size the canvases to the stage. `force` re-applies everything even when the
 * size is unchanged: after a lost 2D context is restored the canvas keeps its
 * dimensions but its transform is back to identity, so the field draws into the
 * top-left 1/dpr of the screen and the same-size early return would never fix it.
 */
export function resizeRenderer(rc: RenderContext, stageEl: HTMLElement, force = false) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const r = stageEl.getBoundingClientRect();
  if (!r.width || !r.height) return;
  if (!force && r.width === rc.W && r.height === rc.H && rc.cv.width) return;

  rc.W = r.width;
  rc.H = r.height;
  rc.cv.width = Math.round(rc.W * dpr);
  rc.cv.height = Math.round(rc.H * dpr);
  rc.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  rc.bgW = Math.max(16, Math.round(rc.W / BG_SCALE));
  rc.bgH = Math.max(16, Math.round(rc.H / BG_SCALE));
  rc.bg.width = rc.bgW;
  rc.bg.height = rc.bgH;

  if (rc.resCv && rc.resCtx) {
    rc.resCv.width = rc.cv.width;
    rc.resCv.height = rc.cv.height;
    rc.resCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Derive every scale-dependent threshold from the field we just sized, through
  // the one function that owns the formula. Setting `SC` here by hand used to
  // leave BOOM_SPEED and KICKOUT_MAX behind at whatever height the tuning
  // panel last happened to pass, so how hard a boom was to trigger drifted with
  // the screen and never updated on rotate.
  recalcThresholds(rc.H);
}

export function drawGame(rc: RenderContext, game: Game, time: number) {
  const { ctx, W, H } = rc;
  if (game.matchOver) {
    rc.bgx.globalCompositeOperation = 'source-over';
    rc.bgx.fillStyle = hex(FIELD_BG);
    rc.bgx.fillRect(0, 0, rc.bgW, rc.bgH);
  } else {
    drawLiquid(rc.bgx, rc.bgW, rc.bgH, game.balls, game.flashes, time);
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(rc.bg, 0, 0, W, H);


  // Draw bond lines
  const R = PhysicsConfig.R;
  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';
  for (const b of game.balls) {
    for (const id of b.bonds) {
      // Bonds are symmetric, so draw each from its lower-id end only. This is
      // the same dedupe the per-frame Set of string keys was doing, without
      // building two strings and a Set entry per bond per frame.
      if (id < b.id) continue;
      const o = game.byId.get(id);
      if (!o) continue;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(o.x, o.y);
      ctx.globalAlpha = 0.35; ctx.lineWidth = R * 0.8;
      // Bonds form between matching colours except through a black special, so
      // the gradient is usually flat. Building one per bond per frame is the
      // most expensive call in this loop; skip it when both ends agree.
      if (b.color === o.color) {
        ctx.strokeStyle = b.color;
      } else {
        const wash = ctx.createLinearGradient(b.x, b.y, o.x, o.y);
        wash.addColorStop(0, b.color); wash.addColorStop(1, o.color);
        ctx.strokeStyle = wash;
      }
      ctx.stroke();
      ctx.globalAlpha = 0.95; ctx.lineWidth = Math.max(1.5, R * 0.16);
      ctx.strokeStyle = rgba(WHITE, 0.9); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // Draw ripple rings
  for (const f of game.flashes) {
    const spec = FLASH_SPECS[f.kind] || FLASH_SPECS.spawn;
    drawRippleRing(ctx, spec, f.x, f.y, R, f.t / FLASH_LIFE, FIELD_RING);
  }
  ctx.globalCompositeOperation = 'source-over';

  // Draw balls
  const d = 2 * R * (SPRITE / (2 * SP_R));
  for (const b of game.balls) {
    if (b.ghost) {
      ctx.globalAlpha = 0.34 * Math.min(1, (PhysicsConfig.GHOST_LIFE - (b.age || 0)) / 1.5);
      ctx.drawImage(ballSprite(b.color, false), b.x - d / 2, b.y - d / 2, d, d);
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(b.x, b.y, R * 0.94, 0, TAU);
      ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(WHITE, 0.5); ctx.stroke();
      continue;
    }
    const grouped = b.group && b.group.members && b.group.members.length > 1;
    const ra = getRainBallAlpha(b.rainTime);
    ctx.globalAlpha = ra;
    ctx.drawImage(ballSprite(b.color, grouped), b.x - d / 2, b.y - d / 2, d, d);
    ctx.globalAlpha = 1;
  }

  if (game.showLabels && R >= MIN_LABEL_RADIUS) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = uiFont(600, Math.round(R * 0.66));
    for (const b of game.balls) {
      const ra = getRainBallAlpha(b.rainTime);
      if (b.ghost) ctx.globalAlpha = 0.5;
      else ctx.globalAlpha = ra;
      ctx.fillStyle = inkOn(b.color);
      ctx.fillText(kindLabel(b.kind), b.x, b.y + 0.5);
      ctx.globalAlpha = 1;
    }
  }

  if (game.twoPlayer) {
    ctx.save();
    ctx.setLineDash([11, 9]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgba(WHITE, 0.3);
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.restore();
  }

  drawLaunchers(rc, game, time);
  drawPops(rc, game);
}

/** Keeps a pop's centre far enough from both edges for `width` of text to fit. */
export function popCenterX(x: number, width: number, canvasWidth: number): number {
  const half = width / 2 + POP_EDGE_PAD;
  if (half * 2 >= canvasWidth) return canvasWidth / 2;
  return Math.max(half, Math.min(canvasWidth - half, x));
}

export function drawPops(rc: RenderContext, game: Game) {
  if (!game.pops.length) return;
  const { ctx, W } = rc;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalCompositeOperation = 'source-over';
  for (const f of game.pops) {
    const k = f.t / POP_LIFE;
    ctx.save();
    ctx.font = uiFont(800, (17 + 8 * (1 - k)).toFixed(1));
    // A pop is centred on the event that earned it, and now carries a word as
    // well as its points, so one earned against a side wall would hang off the
    // screen. Slide it back on rather than letting it clip.
    const text = popText(f.label);
    ctx.translate(popCenterX(f.x, ctx.measureText(text).width, W), f.y);
    if (game.twoPlayer && f.who === 1) ctx.rotate(Math.PI);
    ctx.globalAlpha = Math.max(0, 1 - k * k);
    ctx.fillStyle = P_COLOR[f.who] || WHITE_HEX;
    ctx.shadowColor = BLACK_HEX;
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillText(text, 0, -k * 34);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/**
 * The tutorial's pointer: one slow pulsing ring around the balls a step is
 * about. It points instead of naming a colour, since colour names fail for
 * colour-blind players. Display only, like everything in this file.
 */
export function drawTutorialRing(rc: RenderContext, balls: { x: number; y: number }[], time: number) {
  if (!balls.length) return;
  const { ctx } = rc;
  const R = PhysicsConfig.R;
  let cx = 0, cy = 0;
  for (const b of balls) { cx += b.x; cy += b.y; }
  cx /= balls.length; cy /= balls.length;
  let reach = 0;
  for (const b of balls) reach = Math.max(reach, Math.hypot(b.x - cx, b.y - cy));
  // One breath every 1.6s: slow enough to read as "here", not as an alarm.
  const pulse = 0.5 + 0.5 * Math.sin((time * TAU) / 1.6);
  const r = reach + R * (1.7 + 0.35 * pulse);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = hex(MENU_CYAN);
  ctx.shadowColor = hex(MENU_CYAN);
  ctx.shadowBlur = 14;
  ctx.globalAlpha = 0.35 + 0.4 * pulse;
  ctx.lineWidth = Math.max(2, R * 0.2);
  ctx.setLineDash([R * 0.9, R * 0.55]);
  ctx.lineDashOffset = -time * R * 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/**
 * The tutorial's hint: a fingertip that presses at the launcher, drags out to
 * where a winning throw's drag ends, holds there, and lifts — on a loop, with
 * the path it takes left faintly behind it. `from` and `to` come from
 * `tutorialHint` in `game/Tutorial.ts`, recomputed each frame.
 */
export function drawTutorialHint(rc: RenderContext, hint: { from: { x: number; y: number }; to: { x: number; y: number } } | null, time: number) {
  if (!hint) return;
  const { ctx } = rc;
  const R = PhysicsConfig.R;
  const { from, to } = hint;
  // 2.4s a loop: press 0.25, drag 1.1, hold 0.6, lift 0.45.
  const t = (time % 2.4 + 2.4) % 2.4;
  const ease = (u: number) => u * u * (3 - 2 * u);
  const along = t < 0.25 ? 0 : t < 1.35 ? ease((t - 0.25) / 1.1) : 1;
  const alpha = t < 0.25 ? t / 0.25 : t < 1.95 ? 1 : 1 - (t - 1.95) / 0.45;
  const x = from.x + (to.x - from.x) * along, y = from.y + (to.y - from.y) * along;

  ctx.save();
  // The path, dashed, so the eye can follow it between loops.
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = hex(WHITE);
  ctx.lineWidth = Math.max(2, R * 0.16);
  ctx.setLineDash([R * 0.45, R * 0.4]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // Where it ends: a ring that stays and breathes, so the goal of the drag is
  // never lost, even while the fingertip is back at the launcher. Soft throws
  // end close to the mouth, so it is drawn bold enough to read over the bay.
  const breath = 0.5 + 0.5 * Math.sin((time * TAU) / 1.2);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = hex(MENU_CYAN);
  ctx.shadowColor = hex(MENU_CYAN);
  ctx.shadowBlur = 12;
  ctx.globalAlpha = 0.65 + 0.3 * breath;
  ctx.lineWidth = Math.max(2.5, R * 0.22);
  ctx.beginPath();
  ctx.arc(to.x, to.y, R * (1.25 + 0.15 * breath), 0, TAU);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  // The fingertip: pressed while it drags, a little larger as it lifts.
  const lift = t > 1.95 ? (t - 1.95) / 0.45 : 0;
  ctx.globalAlpha = 0.85 * Math.max(0, alpha);
  ctx.fillStyle = hex(WHITE);
  ctx.shadowColor = hex(MENU_CYAN);
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(x, y, R * (1.0 + 0.4 * lift), 0, TAU);
  ctx.fill();
  ctx.restore();
}

export function drawLaunchers(rc: RenderContext, game: Game, time: number) {
  const activePlayers = game.twoPlayer ? game.players : [game.players[0]];
  for (const p of activePlayers) drawOneLauncher(rc, game, p, time);
}

/**
 * Everything one launcher is painted with.
 *
 * `ring` and `body` are the same colour for both players now. They are kept
 * apart because they were not always: player 1's mouth, reload arc, ready pulse
 * and bead used to be a second cyan `#00e5ff`, ΔE 4.1 from the cyan the rest of
 * that player wore. The two were merged onto `#00e5ff` on 2026-09-19, so a
 * launcher no longer disagrees with the player it belongs to.
 */
interface LauncherPaint {
  /** Mouth ring, reload arc, ready pulse, bead. */
  ring: Rgb;
  /** Inner ring — the player's colour everywhere else. The aim arrow left this
   *  in 2026-09-19 for the `WHITE`-to-`AIM_HOT` power ramp, so the arrow is no
   *  longer one of the things a player's colour says. */
  body: Rgb;
  /** The soft wash under the reload arc. */
  glow: Rgb;
  /** The bead's pale core. */
  bead: Rgb;
}

const LAUNCHER_PAINT: LauncherPaint[] = [
  { ring: CYAN, body: CYAN, glow: [0, 200, 255], bead: [0xb3, 0xf7, 0xff] },
  { ring: PINK, body: PINK, glow: PINK, bead: [0xff, 0xd9, 0xf7] },
];

/** The dark disc the mouth is sunk into. */
const MOUTH_FILL: Rgb = [12, 4, 30];

/** Dash pattern of the aim arrow's shaft. */
const AIM_DASH = [6, 8];

/**
 * The aim arrow's glow, which is where the boom threshold lives.
 *
 * `AIM_GLOW` is the soft white halo a safe throw carries. The moment the throw
 * would boom the halo turns red and steps up to `AIM_GLOW_HOT`, then grows by
 * `AIM_GLOW_HEAT` more as the throw hardens, reaching 32px at full power.
 *
 * The step is deliberate. The shaft's colour ramp starts at white and is still
 * `#ffe7e7` a tenth of the way up the booming range, which is what Tony asked
 * for and which leaves the threshold itself invisible in the shaft. The glow
 * is the channel that can carry it without making the low end red: a pale
 * arrow inside a red halo.
 */
const AIM_GLOW = 10;
const AIM_GLOW_HOT = 14;
const AIM_GLOW_HEAT = 18;

export function drawOneLauncher(rc: RenderContext, game: Game, p: LauncherPlayer, time: number) {
  const { ctx, W, H } = rc;
  const R = PhysicsConfig.R;
  const m = launchPointOf(p, W, H);
  const ready = p.reload <= 0;
  const paint = LAUNCHER_PAINT[game.players.indexOf(p) === 1 ? 1 : 0];
  const mouthR = mouthRadius() + R - 2;

  drawMouth(ctx, m, mouthR, paint);
  if (game.reloadTime > 0 && p.reload > 0) {
    drawReloadArc(ctx, m, mouthR, 1 - p.reload / game.reloadTime, paint);
  } else if (ready) {
    drawReadyPulse(ctx, m, mouthR, time, paint);
  }

  ctx.beginPath();
  ctx.arc(m.x, m.y, R * 1.25, 0, TAU);
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(paint.body, 0.65);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';

  drawLoadedBall(ctx, game, p, m, R, ready, time);
  drawAim(ctx, game, p, m, R, W, H, ready);
}

/** The dark disc and the ring around it. */
function drawMouth(
  ctx: CanvasRenderingContext2D,
  m: { x: number; y: number },
  mouthR: number,
  paint: LauncherPaint
) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath();
  ctx.arc(m.x, m.y, mouthR, 0, TAU);
  ctx.fillStyle = rgba(MOUTH_FILL, 0.42);
  ctx.fill();

  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  ctx.arc(m.x, m.y, mouthR, 0, TAU);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = rgba(paint.body, 0.4);
  ctx.stroke();
}

/** The arc that fills as the launcher reloads, with a bead at its leading end. */
function drawReloadArc(
  ctx: CanvasRenderingContext2D,
  m: { x: number; y: number },
  mouthR: number,
  progress: number,
  paint: LauncherPaint
) {
  const done = Math.max(0, Math.min(1, progress));
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + done * TAU;

  // A soft wash of the team colour under the arc, then the arc itself over it.
  ctx.beginPath();
  ctx.arc(m.x, m.y, mouthR, startAngle, endAngle);
  ctx.lineWidth = 4.5;
  ctx.strokeStyle = rgba(paint.glow, 0.4);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(m.x, m.y, mouthR, startAngle, endAngle);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = rgba(paint.ring, 1);
  ctx.stroke();

  // The bead riding the leading end, with a paler core inside it.
  const tipX = m.x + Math.cos(endAngle) * mouthR;
  const tipY = m.y + Math.sin(endAngle) * mouthR;
  ctx.beginPath();
  ctx.arc(tipX, tipY, 3.5, 0, TAU);
  ctx.fillStyle = hex(paint.ring);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(tipX, tipY, 1.8, 0, TAU);
  ctx.fillStyle = hex(paint.bead);
  ctx.fill();
}

/** The slow breath a loaded, ready launcher gives off. */
function drawReadyPulse(
  ctx: CanvasRenderingContext2D,
  m: { x: number; y: number },
  mouthR: number,
  time: number,
  paint: LauncherPaint
) {
  const alpha = 0.25 + 0.15 * Math.sin(time * 4);
  ctx.beginPath();
  ctx.arc(m.x, m.y, mouthR, 0, TAU);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = rgba(paint.ring, +alpha.toFixed(2));
  ctx.stroke();
}

/** The ball sitting in the mouth, bobbing while it waits to be thrown. */
function drawLoadedBall(
  ctx: CanvasRenderingContext2D,
  game: Game,
  p: LauncherPlayer,
  m: { x: number; y: number },
  R: number,
  ready: boolean,
  time: number
) {
  if (!p.loaded) return;
  const bob = ready ? 1 + 0.04 * Math.sin(time * 2.6) : 1;
  const d = 2 * R * (SPRITE / (2 * SP_R)) * bob;
  ctx.drawImage(ballSprite(p.loaded.color, false), m.x - d / 2, m.y - d / 2, d, d);
  if (!game.showLabels || R < MIN_LABEL_RADIUS) return;
  ctx.save();
  ctx.translate(m.x, m.y);
  if (p.side < 0) ctx.rotate(Math.PI);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = uiFont(600, Math.round(R * 0.66));
  ctx.fillStyle = inkOn(p.loaded.color);
  ctx.fillText(kindLabel(p.loaded.kind), 0, 0.5);
  ctx.restore();
}

/** Where the aim arrow starts, ends, and how heavy it is drawn. */
interface AimGeometry {
  fromX: number;
  fromY: number;
  tipX: number;
  tipY: number;
  dir: number;
  headLength: number;
  headWidth: number;
  lineWidth: number;
}

/**
 * The dashed shaft and its two head strokes.
 *
 * Drawn twice: an outline pass underneath that keeps the arrow legible over the
 * background, then the power-coloured pass over it. `widen` is what separates
 * them — the outline is 1.5px broader on both strokes so it reads as an edge
 * rather than as a second arrow.
 *
 * That outline was white until the arrow itself became white at low power, which
 * left a white arrow edged in white over whatever it crossed. It is `VOID` now:
 * a dark edge separates both ends of the ramp from the liquid background, whose
 * currents add up to a pale lavender (`CURRENT_CEILING` in `VisualFX.ts`) where
 * several overlap. The glow the white pass used to give is kept as a shadow in
 * the arrow's own colour, so a hot arrow now glows red instead of white.
 */
function strokeAim(ctx: CanvasRenderingContext2D, g: AimGeometry, color: string, widen: number) {
  ctx.setLineDash(AIM_DASH);
  ctx.beginPath();
  ctx.moveTo(g.fromX, g.fromY);
  ctx.lineTo(g.tipX, g.tipY);
  ctx.lineWidth = g.lineWidth + widen;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  for (const side of [-0.5, 0.5]) {
    ctx.moveTo(g.tipX, g.tipY);
    ctx.lineTo(g.tipX - Math.cos(g.dir + side) * g.headLength, g.tipY - Math.sin(g.dir + side) * g.headLength);
  }
  ctx.lineWidth = g.headWidth + widen;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** The aim arrow: how the player is pointed, and how hard they are about to throw. */
function drawAim(
  ctx: CanvasRenderingContext2D,
  game: Game,
  p: LauncherPlayer,
  m: { x: number; y: number },
  R: number,
  W: number,
  H: number,
  ready: boolean
) {
  const dir = aimDirOf(p);
  const reach = aimReachOf(p, W, H, game.twoPlayer);
  const fade = ready ? 1 : 0.35;
  // White for every throw that will not boom, then reddening the whole way from
  // the boom threshold to full power — `boomHeatOf` is 0 over the first range
  // and climbs across the second, so the ramp is spent on the throws a player
  // is choosing between rather than on the ones that all land the same. No
  // `LauncherPaint` reaches this function any more: it is the same arrow for
  // both players, told apart by which bay it grows out of.
  const heat = boomHeatOf(p, game.twoPlayer);
  const hot = boomsOnImpact(p, game.twoPlayer);
  const aimRgb = mix(WHITE, AIM_HOT, heat);
  const aimColor = rgba(aimRgb, +((0.65 + 0.35 * p.strength) * fade).toFixed(3));

  const g: AimGeometry = {
    fromX: m.x + Math.cos(dir) * R * 1.1,
    fromY: m.y + Math.sin(dir) * R * 1.1,
    tipX: m.x + Math.cos(dir) * reach,
    tipY: m.y + Math.sin(dir) * reach,
    dir,
    headLength: 11 + p.strength * 18,
    headWidth: 2.5 + p.strength * 3,
    lineWidth: 2 + p.strength * 3,
  };

  // The glow says whether the throw booms; the shaft says how hard. A safe
  // throw is white inside a white halo, and the halo goes red at the threshold,
  // where the shaft is still all but white.
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowColor = rgba(hot ? AIM_HOT : WHITE, +((hot ? 0.7 + 0.25 * heat : 0.6) * fade).toFixed(3));
  ctx.shadowBlur = hot ? AIM_GLOW_HOT + AIM_GLOW_HEAT * heat : AIM_GLOW;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  strokeAim(ctx, g, rgba(VOID, +(0.55 * fade).toFixed(3)), 1.5);
  ctx.restore();

  ctx.globalCompositeOperation = 'lighter';
  strokeAim(ctx, g, aimColor, 0);
  ctx.globalCompositeOperation = 'source-over';
}

export function drawResultsCanvas(rc: RenderContext, game: Game) {
  if (!rc.resCv || !rc.resCtx) return;
  const { resCtx: ctx, W, H } = rc;

  ctx.clearRect(0, 0, W, H);
  if (!game.matchOver) {
    setHidden(rc.resCv, true);
    return;
  }
  setHidden(rc.resCv, false);

  const R = PhysicsConfig.R;

  // Draw celebratory flashes on results overlay canvas (above the dark blurred backdrop)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const f of game.flashes) {
    const spec = FLASH_SPECS[f.kind] || FLASH_SPECS.spawn;
    drawRippleRing(ctx, spec, f.x, f.y, R, f.t / FLASH_LIFE, RESULTS_RING);
  }
  ctx.restore();

  // Draw celebratory floating pops on results overlay canvas (above the dark blurred backdrop)
  if (game.pops.length) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalCompositeOperation = 'source-over';
    for (const f of game.pops) {
      const k = f.t / POP_LIFE;
      ctx.save();
      ctx.translate(f.x, f.y);
      if (game.twoPlayer && f.who === 1) ctx.rotate(Math.PI);
      const alpha = Math.max(0, 1 - k * k);
      ctx.globalAlpha = alpha;
      const fontSize = (17 + 8 * (1 - k)).toFixed(1);
      ctx.font = uiFont(800, fontSize);
      const color = P_COLOR[f.who] || hex(MENU_CYAN);
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = color;
      const text = popText(f.label);
      ctx.fillText(text, 0, -k * 34);

      ctx.fillStyle = WHITE_HEX;
      ctx.shadowBlur = 4;
      ctx.fillText(text, 0, -k * 34);
      ctx.restore();
    }
    ctx.restore();
  }
}
