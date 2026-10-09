/**
 * The landing page of the web deploy (home.html, served at /): the game's own
 * logo, animated as on the menu, over the menu's light beams and a few
 * drifting balls; what the game is; Play now (to /play); Install, where the
 * browser offers it; and the privacy page. Silent: no audio is created here.
 */
import { computeMenuLayout } from '../ui/menu/MenuLayout';
import { drawLogo } from '../ui/menu/LogoArt';
import { drawBackground } from '../ui/menu/MenuAmbience';
import { ballSprite, glowSprite } from '../graphics/Sprites';
import { BALL_COLORS, BLACK_HEX, WHITE_HEX } from '../graphics/Palette';
import { isLangId, setLanguage, startingLanguage } from '../i18n/I18n';
import { registerOffline } from '../ui/Offline';

const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Words ────────────────────────────────────────────────────────────────
{
  const reveal = () => document.documentElement.classList.remove('i18n-loading');
  setTimeout(reveal, 1500);
  const forced = new URLSearchParams(location.search).get('lang');
  void setLanguage(isLangId(forced) ? forced : startingLanguage()).finally(reveal);
}

// ── Install ──────────────────────────────────────────────────────────────
// Chrome and Edge offer an install prompt once the page qualifies (a manifest
// and the offline worker); Safari has none, and there the button stays hidden.
{
  const btn = document.getElementById('home-install') as HTMLButtonElement | null;
  let offer: (Event & { prompt(): Promise<void> }) | null = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    offer = e as Event & { prompt(): Promise<void> };
    if (btn) btn.hidden = false;
  });
  window.addEventListener('appinstalled', () => { if (btn) btn.hidden = true; });
  btn?.addEventListener('click', () => {
    if (!offer) return;
    void offer.prompt().finally(() => { offer = null; btn.hidden = true; });
  });
}
registerOffline();

// ── The logo and the background ──────────────────────────────────────────
const bg = document.getElementById('home-bg') as HTMLCanvasElement;
const logo = document.getElementById('home-logo') as HTMLCanvasElement;
const bgx = bg.getContext('2d')!;
const lx = logo.getContext('2d')!;

interface Drifter { x: number; y: number; vx: number; vy: number; r: number; color: string }
let drifters: Drifter[] = [];
let W = 0, H = 0, LW = 0, LH = 0, dpr = 1;

function seed() {
  const colors = [...BALL_COLORS.slice(0, 3), BLACK_HEX, WHITE_HEX];
  drifters = Array.from({ length: 9 }, (_, i) => ({
    x: Math.random() * W, y: Math.random() * H,
    vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
    r: 12 + Math.random() * 6, color: colors[i % colors.length],
  }));
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  W = window.innerWidth; H = window.innerHeight;
  bg.width = Math.round(W * dpr); bg.height = Math.round(H * dpr);
  bgx.setTransform(dpr, 0, 0, dpr, 0, 0);
  LW = logo.parentElement ? logo.parentElement.clientWidth : W;
  // The menu's own sizing, then a canvas just tall enough for the wordmark.
  const layout = computeMenuLayout(LW, 1000, lx);
  LH = Math.ceil(layout.ballRadius * 3.6);
  logo.width = Math.round(LW * dpr); logo.height = Math.round(LH * dpr);
  logo.style.height = LH + 'px';
  lx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!drifters.length) seed();
}

let frame = 0, last = 0;
function draw(now: number) {
  const step = last ? Math.min(3, (now - last) * 0.06) : 1;
  last = now;
  frame += reduceMotion ? 0 : step;

  bgx.clearRect(0, 0, W, H);
  drawBackground(bgx, W, H, frame);
  for (const d of drifters) {
    if (!reduceMotion) {
      d.x += d.vx * step; d.y += d.vy * step;
      if (d.x < -40) d.x = W + 40; if (d.x > W + 40) d.x = -40;
      if (d.y < -40) d.y = H + 40; if (d.y > H + 40) d.y = -40;
    }
    const s = d.r * 2;
    bgx.globalAlpha = 0.35;
    bgx.drawImage(glowSprite(d.color), d.x - s * 1.2, d.y - s * 1.2, s * 2.4, s * 2.4);
    bgx.globalAlpha = 0.7;
    bgx.drawImage(ballSprite(d.color, false), d.x - d.r, d.y - d.r, s, s);
  }
  bgx.globalAlpha = 1;

  lx.clearRect(0, 0, LW, LH);
  const layout = computeMenuLayout(LW, 1000, lx);
  drawLogo(lx, { ...layout, logoCenterY: LH / 2 + layout.ballRadius * 0.15 }, LW, frame);

  if (!reduceMotion || frame === 0) requestAnimationFrame(draw);
}

window.addEventListener('resize', resize);
resize();
// The wordmark is measured in its own typeface: draw again once it has loaded.
document.fonts?.ready.then(resize);
requestAnimationFrame(draw);
if (reduceMotion) document.fonts?.ready.then(() => requestAnimationFrame(draw));
