import { AudioStore, isOptionsOpen, isStopped } from '../../audio/SynthEngine';
import { tList } from '../../i18n/I18n';
import { playNote, playRandomGameBoom } from '../../audio/Voices';
import { clickHz, initMenuAudio, playBinauralClick } from '../../audio/UiSounds';
import { pitchOf } from '../../audio/SoundEvents';
import { Flash, FLASH_LIFE, POP_LIFE, Pop } from '../../physics/Types';
import { CURRENTS, FLASH_SPECS, MENU_RING, drawRippleRing, ringFade, ringRadius } from '../../graphics/VisualFX';
import { ballSprite, glowSprite } from '../../graphics/Sprites';
import { uiFont } from '../../graphics/Fonts';
import { colorOfKind, randomKind } from '../../game/Rules';
import { BLACK_HEX, MENU_CYAN, MENU_PINK_DEEP, PINK, Rgb, WHITE, WHITE_HEX, hex, rgb, rgba } from '../../graphics/Palette';
import { P_COLOR } from '../../graphics/Renderer';
import { popText } from '../../graphics/PopText';
import { TAU } from '../../math';

/**
 * Everything that drifts, glows and pops behind the menu.
 *
 * Five systems share this file because they share a shape: each owns a list, a
 * spawner and an update-and-draw pass called once a frame. None of them keeps a
 * canvas or a size of its own — the caller passes both, so the menu's render
 * loop stays the one place that decides what a frame is.
 *
 * The attract loop deliberately plays the game's real voices rather than UI
 * blips, so the menu previews the match's tonal range.
 */

// ── Drifting motes ──────────────────────────────────────────────────────

interface Mote {
  x: number;
  y: number;
  radius: number;
  speedY: number;
  speedX: number;
  alpha: number;
  pulse: number;
}

const motes: Mote[] = [];
const NUM_MOTES = 75;

function initMotes(width: number, height: number) {
  motes.length = 0;
  for (let i = 0; i < NUM_MOTES; i++) {
    motes.push({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 2.0 + 0.6,
      speedY: -(Math.random() * 0.35 + 0.12),
      speedX: (Math.random() - 0.5) * 0.25,
      alpha: Math.random() * 0.65 + 0.25,
      pulse: Math.random() * TAU
    });
  }
}

// ── Ambient menu background balls and bonds ─────────────────────────────

interface MenuBall {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  kind: number;
}
const menuBalls: MenuBall[] = [];
const NUM_MENU_BALLS = 8;
let lastBondFlashTime = 0;

function initMenuBalls(width: number, height: number) {
  menuBalls.length = 0;
  if (width <= 0 || height <= 0) return;
  const pad = 40;
  for (let i = 0; i < NUM_MENU_BALLS; i++) {
    const kind = randomKind();
    const isSpecial = Math.random() < 0.15;
    const color = isSpecial ? (Math.random() < 0.5 ? BLACK_HEX : WHITE_HEX) : colorOfKind(kind);
    menuBalls.push({
      id: i + 1,
      x: pad + Math.random() * (width - pad * 2),
      y: pad + Math.random() * (height - pad * 2),
      vx: (Math.random() - 0.5) * 0.9,
      vy: (Math.random() - 0.5) * 0.9,
      radius: Math.floor(Math.random() * 4 + 13),
      color,
      kind
    });
  }
}

/** Respawn the motes and the drifting balls for a new canvas size. */
export function initAmbience(width: number, height: number) {
  initMotes(width, height);
  initMenuBalls(width, height);
}

export function drawMenuBalls(c: CanvasRenderingContext2D, width: number, height: number) {
  if (menuBalls.length === 0) return;

  const pad = 25;
  c.save();

  // Update positions and bounce off boundaries
  for (let i = 0; i < menuBalls.length; i++) {
    const b = menuBalls[i];
    b.x += b.vx;
    b.y += b.vy;

    if (b.x < pad) { b.x = pad; b.vx *= -1; }
    if (b.x > width - pad) { b.x = width - pad; b.vx *= -1; }
    if (b.y < pad) { b.y = pad; b.vy *= -1; }
    if (b.y > height - pad) { b.y = height - pad; b.vy *= -1; }
  }

  // Draw glowing bond lines between nearby balls
  c.globalCompositeOperation = 'lighter';
  c.lineCap = 'round';
  const now = performance.now();

  for (let i = 0; i < menuBalls.length; i++) {
    for (let j = i + 1; j < menuBalls.length; j++) {
      const b1 = menuBalls[i];
      const b2 = menuBalls[j];
      const dx = b2.x - b1.x;
      const dy = b2.y - b1.y;
      const distSq = dx * dx + dy * dy;
      const maxDist = 150;

      if (distSq < maxDist * maxDist) {
        const dist = Math.sqrt(distSq);
        const alpha = Math.max(0, 1 - dist / maxDist) * 0.5;

        c.beginPath();
        c.moveTo(b1.x, b1.y);
        c.lineTo(b2.x, b2.y);
        c.globalAlpha = alpha * 0.45;
        c.lineWidth = 9;
        const wash = c.createLinearGradient(b1.x, b1.y, b2.x, b2.y);
        wash.addColorStop(0, b1.color);
        wash.addColorStop(1, b2.color);
        c.strokeStyle = wash;
        c.stroke();

        c.globalAlpha = alpha * 0.85;
        c.lineWidth = 1.8;
        c.strokeStyle = rgba(WHITE, 0.8);
        c.stroke();

        // Trigger flash when two balls drift very close
        if (dist < (b1.radius + b2.radius) * 1.8 && now - lastBondFlashTime > 800) {
          lastBondFlashTime = now;
          spawnMenuFlash(width, (b1.x + b2.x) / 2, (b1.y + b2.y) / 2, 'bond', pitchOf(b1.kind));
        }
      }
    }
  }

  // Draw background menu balls with sprite and glowing aura
  c.globalCompositeOperation = 'source-over';
  for (const b of menuBalls) {
    const d = b.radius * 2;
    c.globalAlpha = 0.55;
    c.drawImage(glowSprite(b.color), b.x - d * 1.2, b.y - d * 1.2, d * 2.4, d * 2.4);

    c.globalAlpha = 0.85;
    c.drawImage(ballSprite(b.color, false), b.x - b.radius, b.y - b.radius, d, d);
  }

  c.restore();
}

// ── Randomized menu in-game flashes ─────────────────────────────────────

interface MenuFlash extends Flash {
  id: number;
}
const menuFlashes: MenuFlash[] = [];
let nextFlashId = 1;
let lastAutoFlashTime = 0;

/** Virtual ball radius the menu's flashes are sized against. */
const MENU_FLASH_R = 22;

/**
 * Spawn a menu flash and play the sound the same event makes in a match.
 *
 * The menu used to play a `playBinauralClick` blip for every flash kind. That
 * routed all four through the `'hover'` branch, which clamps the frequency to
 * 261.63Hz — so bond's 330Hz was pulled down to the same note as the others and
 * the whole menu came out as one low tone. The game's voices are pitched off
 * the scale (`SCALE_NOTES`), so playing them here gives the menu the tonal range a
 * match has. `rel` picks the scale degree; pass the ball's kind through where
 * there is one, exactly as the collision solver does.
 *
 * `blocked` keeps the UI click: it is a "no" from the interface, not a game event.
 */
function spawnMenuFlash(
  width: number,
  x: number,
  y: number,
  kind?: 'bond' | 'break' | 'spawn' | 'blocked',
  rel?: number
) {
  if (isOptionsOpen()) return;
  const kinds: ('bond' | 'break' | 'spawn' | 'blocked')[] = ['bond', 'break', 'spawn', 'blocked'];
  const k = kind || kinds[Math.floor(Math.random() * kinds.length)];
  menuFlashes.push({ id: nextFlashId++, x, y, t: 0, kind: k });

  if (!AudioStore.soundOn) return;
  const normX = width > 0 ? (x / width) * 2 - 1 : 0;
  if (k === 'blocked') {
    // A click only once the audio is playing: before the first tap it would sit
    // queued on the stopped context and go off with everything else on the tap.
    if (AudioStore.actx && !isStopped(AudioStore.actx)) playBinauralClick(clickHz('cancel'), 0.2, normX, 'hover');
    return;
  }
  initMenuAudio();
  if (k === 'spawn') {
    // A boom on the menu is a real one, drawn from the spread of chain sizes a
    // match actually produces, rather than the bare `playNote(..., 'boom')`
    // this used to make — that passes no chain size, so every menu boom was the
    // smallest tier and the range never showed.
    playRandomGameBoom(normX, 'menu');
    return;
  }
  playNote(rel !== undefined ? rel : Math.random(), normX,
    k === 'break' ? 'break' : 'bond');
}

export function drawMenuFlashes(c: CanvasRenderingContext2D, width: number, height: number) {
  const now = performance.now();
  if (menuFlashes.length < 4 && now - lastAutoFlashTime > 1200 + Math.random() * 1800) {
    lastAutoFlashTime = now;
    const rx = width * (0.10 + Math.random() * 0.80);
    const ry = height * (0.12 + Math.random() * 0.76);
    spawnMenuFlash(width, rx, ry);
  }

  c.save();
  c.globalCompositeOperation = 'lighter';

  for (let i = menuFlashes.length - 1; i >= 0; i--) {
    const f = menuFlashes[i];
    f.t += 0.016;
    const spec = FLASH_SPECS[f.kind] || FLASH_SPECS.spawn;
    const p = f.t / FLASH_LIFE;
    if (p >= 1) {
      menuFlashes.splice(i, 1);
      continue;
    }

    const rad = ringRadius(spec, MENU_FLASH_R, p);
    if (rad > 0) {
      // Glow background blob
      const bgRad = rad * 1.5;
      c.globalAlpha = 0.5 * ringFade(p);
      c.drawImage(glowSprite(rgb(spec.color)), f.x - bgRad, f.y - bgRad, bgRad * 2, bgRad * 2);

      // The ring is drawn under the blob's `globalAlpha`, not at full strength:
      // that is how the menu's rings have always been dimmer than the field's,
      // over and above their lower stroke alpha.
      drawRippleRing(c, spec, f.x, f.y, MENU_FLASH_R, p, MENU_RING);
    }
  }

  c.restore();
}

// ── Randomized menu in-game pops ────────────────────────────────────────

interface MenuPop extends Pop {
  id: number;
  vy: number;
}
const menuPops: MenuPop[] = [];

/** Drop the words in the air, so none of the old language lingers after a switch. */
export function clearMenuPops() {
  menuPops.length = 0;
}
let nextPopId = 1;
let lastAutoPopTime = 0;

// The words are the player's language; the scores are the same everywhere.
const POP_SCORES = ['+100', '+500', '+1000'];
const popTexts = () => [...tList('menu.pops'), ...POP_SCORES];

function spawnMenuPop(width: number, height: number) {
  if (isOptionsOpen()) return;
  const px = width * (0.15 + Math.random() * 0.70);
  const py = height * (0.20 + Math.random() * 0.60);
  const texts = popTexts();
  const txt = texts[Math.floor(Math.random() * texts.length)];
  const w = Math.random() < 0.5 ? 0 : 1;

  menuPops.push({
    id: nextPopId++,
    x: px,
    y: py,
    t: 0,
    label: { text: txt },
    who: w,
    vy: -(Math.random() * 0.4 + 0.5)
  });

  if (AudioStore.soundOn && !isOptionsOpen() && Math.random() < 0.35) {
    const normX = width > 0 ? (px / width) * 2 - 1 : 0;
    playBinauralClick(247.94, 0.18, normX, 'hover');
  }
}

export function drawMenuPops(c: CanvasRenderingContext2D, width: number, height: number) {
  const now = performance.now();
  if (menuPops.length < 3 && now - lastAutoPopTime > 1800 + Math.random() * 2200) {
    lastAutoPopTime = now;
    spawnMenuPop(width, height);
  }

  c.save();
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.globalCompositeOperation = 'source-over';

  for (let i = menuPops.length - 1; i >= 0; i--) {
    const pop = menuPops[i];
    pop.t += 0.016;
    pop.y += pop.vy;

    const k = pop.t / POP_LIFE;
    if (k >= 1) {
      menuPops.splice(i, 1);
      continue;
    }

    c.save();
    c.translate(pop.x, pop.y);
    const alpha = Math.max(0, 1 - k * k);
    c.globalAlpha = alpha;

    const fontSize = 17 + 8 * (1 - k);
    c.font = uiFont(800, fontSize.toFixed(1));
    const color = P_COLOR[pop.who] || hex(MENU_CYAN);

    c.shadowColor = color;
    c.shadowBlur = 12;
    c.fillStyle = color;
    const text = popText(pop.label);
    c.fillText(text, 0, -k * 30);

    c.fillStyle = WHITE_HEX;
    c.shadowBlur = 4;
    c.fillText(text, 0, -k * 30);

    c.restore();
  }

  c.restore();
}

// ── Floating sound notes around the logo ────────────────────────────────

const noteSymbols = ['♪', '♫', '♬', '♩', '𝄢'];
const noteColors: { main: Rgb; glowAlpha: number }[] = [
  { main: MENU_CYAN, glowAlpha: 0.95 },
  { main: PINK, glowAlpha: 0.95 },
  { main: [0x00, 0xe5, 0xff], glowAlpha: 0.90 },
  { main: [0xe8, 0x79, 0xf9], glowAlpha: 0.90 },
  { main: [0xc0, 0x84, 0xfc], glowAlpha: 0.90 },
];

interface SoundNote {
  symbol: string;
  color: string;
  glow: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotSpeed: number;
  opacity: number;
  maxOpacity: number;
  life: number;
  maxLife: number;
  pulseSpeed: number;
  pulseOffset: number;
}

const notes: SoundNote[] = [];
const MAX_NOTES = 7;

function createSoundNote(centerX: number, centerY: number, boundsW: number, boundsH: number): SoundNote {
  const sym = noteSymbols[Math.floor(Math.random() * noteSymbols.length)];
  const colorObj = noteColors[Math.floor(Math.random() * noteColors.length)];
  const spawnAngle = Math.random() * TAU;
  const spreadX = (boundsW * 0.52) * (0.4 + Math.random() * 0.65);
  const spreadY = (boundsH * 0.58) * (0.4 + Math.random() * 0.65);

  return {
    symbol: sym,
    color: hex(colorObj.main),
    glow: rgba(colorObj.main, colorObj.glowAlpha),
    x: centerX + Math.cos(spawnAngle) * spreadX,
    y: centerY + Math.sin(spawnAngle) * spreadY,
    vx: (Math.random() - 0.5) * 0.35 + Math.cos(spawnAngle) * 0.12,
    vy: -(Math.random() * 0.40 + 0.25),
    size: Math.floor(Math.random() * 22 + 30),
    rotation: (Math.random() - 0.5) * 0.4,
    rotSpeed: (Math.random() - 0.5) * 0.015,
    opacity: 0,
    maxOpacity: Math.random() * 0.6 + 0.35,
    life: 0,
    maxLife: Math.floor(Math.random() * 140 + 110),
    pulseSpeed: Math.random() * 0.05 + 0.03,
    pulseOffset: Math.random() * TAU
  };
}

export function drawSoundNotes(
  c: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  boundsW: number,
  boundsH: number
) {
  if (notes.length < MAX_NOTES && Math.random() < 0.04) {
    notes.push(createSoundNote(centerX, centerY, boundsW, boundsH));
  }

  c.save();
  c.textAlign = 'center';
  c.textBaseline = 'middle';

  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    n.life++;
    n.x += n.vx;
    n.y += n.vy;
    n.rotation += n.rotSpeed;

    const progress = n.life / n.maxLife;
    if (progress < 0.18) {
      n.opacity = (progress / 0.18) * n.maxOpacity;
    } else if (progress > 0.70) {
      n.opacity = ((1 - progress) / 0.30) * n.maxOpacity;
    } else {
      n.opacity = n.maxOpacity;
    }

    const pulse = 1 + Math.sin(n.life * n.pulseSpeed + n.pulseOffset) * 0.12;
    const currentSize = Math.max(12, n.size * pulse);

    c.save();
    c.translate(n.x, n.y);
    c.rotate(n.rotation);
    c.font = uiFont(700, currentSize);
    c.globalAlpha = Math.max(0, Math.min(1, n.opacity));

    c.shadowColor = n.glow;
    c.shadowBlur = 16;
    c.fillStyle = n.color;
    c.fillText(n.symbol, 0, 0);

    c.fillStyle = WHITE_HEX;
    c.shadowBlur = 4;
    c.fillText(n.symbol, 0, 0);

    c.restore();

    if (n.life >= n.maxLife) {
      notes.splice(i, 1);
    }
  }
  c.restore();
}

// ── The backdrop: gradient, currents, spotlights, motes ─────────────────

const spotlights: { baseX: number; baseY: number; angle: number; spread: number; color: Rgb; intensity: number; pulseSpeed: number; pulseOffset: number }[] = [
  { baseX: 0.16, baseY: -0.18, angle: 0.40, spread: 0.52, color: MENU_CYAN, intensity: 0.46, pulseSpeed: 0.012, pulseOffset: 0.0 },
  { baseX: 0.50, baseY: -0.22, angle: 0.0, spread: 0.65, color: MENU_PINK_DEEP, intensity: 0.48, pulseSpeed: 0.015, pulseOffset: 2.1 },
  { baseX: 0.84, baseY: -0.18, angle: -0.40, spread: 0.52, color: [0xa5, 0x00, 0xff], intensity: 0.42, pulseSpeed: 0.010, pulseOffset: 3.8 },
  { baseX: 0.50, baseY: -0.10, angle: 0.0, spread: 0.35, color: MENU_CYAN, intensity: 0.25, pulseSpeed: 0.020, pulseOffset: 1.0 }
];

export function drawBackground(c: CanvasRenderingContext2D, width: number, height: number, t: number) {
  c.save();
  c.shadowBlur = 0;
  c.shadowColor = 'transparent';
  c.globalAlpha = 1.0;
  c.globalCompositeOperation = 'source-over';

  const bgGrad = c.createRadialGradient(
    width * 0.5, height * 0.35, width * 0.08,
    width * 0.5, height * 0.5, Math.max(width, height) * 0.98
  );
  bgGrad.addColorStop(0.00, '#1c0836');
  bgGrad.addColorStop(0.38, '#0f0520');
  bgGrad.addColorStop(0.72, '#070212');
  bgGrad.addColorStop(1.00, '#020106');
  c.fillStyle = bgGrad;
  c.fillRect(0, 0, width, height);

  // Dynamic Liquid Plasma Currents (as in game VisualFX)
  c.save();
  c.globalCompositeOperation = 'lighter';
  const liquidT = t * 0.010;
  for (const cur of CURRENTS) {
    const cx = width * (0.5 + cur.ax * Math.sin(liquidT * cur.sx + cur.ph));
    const cy = height * (0.5 + cur.ay * Math.cos(liquidT * cur.sy + cur.ph * 1.7));
    const cr = height * cur.r;
    c.globalAlpha = 0.38;
    c.drawImage(glowSprite(cur.c), cx - cr, cy - cr, cr * 2, cr * 2);
  }
  c.restore();

  c.save();
  c.globalCompositeOperation = 'screen';

  spotlights.forEach((spot, idx) => {
    const pulse = Math.sin(t * spot.pulseSpeed + spot.pulseOffset) * 0.10;
    const currentIntensity = spot.intensity + pulse;
    const originX = width * spot.baseX + Math.sin(t * 0.005 + idx * 1.5) * (width * 0.035);
    const originY = height * spot.baseY;

    const coneHeight = height * 1.45;
    const targetX = width * spot.baseX + Math.tan(spot.angle) * coneHeight;
    const halfSpread = (coneHeight * spot.spread) * 0.65;

    c.beginPath();
    c.moveTo(originX, originY);
    c.lineTo(targetX - halfSpread, height);
    c.lineTo(targetX + halfSpread, height);
    c.closePath();

    const coneGrad = c.createLinearGradient(originX, originY, targetX, height);
    coneGrad.addColorStop(0.00, rgba(spot.color, currentIntensity * 1.6));
    coneGrad.addColorStop(0.30, rgba(spot.color, currentIntensity * 0.90));
    coneGrad.addColorStop(0.70, rgba(spot.color, currentIntensity * 0.40));
    coneGrad.addColorStop(1.00, rgba(spot.color, currentIntensity * 0.10));

    c.fillStyle = coneGrad;
    c.fill();
  });

  c.restore();

  c.save();
  c.fillStyle = WHITE_HEX;
  motes.forEach(m => {
    m.y += m.speedY;
    m.x += m.speedX + Math.sin(t * 0.01 + m.pulse) * 0.22;
    if (m.y < -10) m.y = height + 10;
    if (m.x < -10) m.x = width + 10;
    if (m.x > width + 10) m.x = -10;

    const flicker = Math.sin(t * 0.03 + m.pulse) * 0.25 + 0.75;
    c.globalAlpha = m.alpha * flicker * 0.65;
    c.beginPath();
    c.arc(m.x, m.y, m.radius, 0, TAU);
    c.fill();
  });
  c.restore();

  c.restore();
}
