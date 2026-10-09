/**
 * Draw the app's icons and splash screens from the logo's own artwork.
 *
 * The icon is the heart of the wordmark: the white ball striking the black one,
 * with the boom between them, drawn by the same `drawBilliardBall` and
 * `drawImpactBoom` the menu uses, on the app's dark background. It writes:
 *
 * - Android launcher icons, legacy square and round, and the adaptive icon's
 *   foreground layer, at every density;
 * - Android splash screens, portrait and landscape, at every density;
 * - the web icons (`public/icon-*.png`, the favicon and the Apple touch icon);
 * - a 512px store icon, to `store/`, for the Play listing;
 * - the iOS app icon and splash.
 *
 *   npm run make:icons
 *
 * It needs a browser, like `check:strip`, so it is not part of `npm run verify`.
 * Set CHROME to a Chromium executable if Playwright cannot find one by itself.
 * Written 2026-10-09: the native apps still carried Capacitor's placeholder.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { deflateSync } from 'zlib';

/** The splash and status bar colour in `capacitor.config.json`. */
const BG = '#120726';
const DENSITIES: [string, number][] = [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]];
const RES = 'android/app/src/main/res';

type Kind = 'foreground' | 'square' | 'round' | 'splash' | 'web';
/** `opaque`: written as RGB with no alpha channel, which the App Store requires of an app icon. */
interface Job { path: string; w: number; h: number; kind: Kind; opaque?: boolean }

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** A PNG of colour type 2 (RGB, no alpha) from RGBA pixels. A canvas can only export RGBA. */
function rgbPng(rgba: Buffer, w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1]; raw[o + 2] = rgba[i + 2];
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const jobs: Job[] = [];
for (const [d, k] of DENSITIES) {
  jobs.push({ path: `${RES}/mipmap-${d}/ic_launcher.png`, w: 48 * k, h: 48 * k, kind: 'square' });
  jobs.push({ path: `${RES}/mipmap-${d}/ic_launcher_round.png`, w: 48 * k, h: 48 * k, kind: 'round' });
  jobs.push({ path: `${RES}/mipmap-${d}/ic_launcher_foreground.png`, w: 108 * k, h: 108 * k, kind: 'foreground' });
  jobs.push({ path: `${RES}/drawable-port-${d}/splash.png`, w: 320 * k, h: 480 * k, kind: 'splash' });
  jobs.push({ path: `${RES}/drawable-land-${d}/splash.png`, w: 480 * k, h: 320 * k, kind: 'splash' });
}
jobs.push({ path: `${RES}/drawable/splash.png`, w: 480, h: 320, kind: 'splash' });
for (const s of [32, 180, 192, 512]) {
  const name = s === 32 ? 'favicon.png' : s === 180 ? 'apple-touch-icon.png' : `icon-${s}.png`;
  jobs.push({ path: `public/${name}`, w: s, h: s, kind: 'web' });
}
jobs.push({ path: 'store/icon-512.png', w: 512, h: 512, kind: 'square' });
// iOS: one 1024px icon, opaque as the App Store requires, and the square splash.
const IOS = 'ios/App/App/Assets.xcassets';
jobs.push({ path: `${IOS}/AppIcon.appiconset/AppIcon-512@2x.png`, w: 1024, h: 1024, kind: 'square', opaque: true });
for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  jobs.push({ path: `${IOS}/Splash.imageset/${f}`, w: 2732, h: 2732, kind: 'splash' });
}

async function main() {
  const server = await createServer({ server: { port: 5479, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:5479/');
    for (const job of jobs) {
      // Sent as a string: vite-node would otherwise rewrite the dynamic import.
      const data = await page.evaluate(`(async () => {
        const { drawBilliardBall, drawImpactBoom, WHITE_BALL, BLACK_BALL } = await import('/src/ui/menu/LogoArt.ts');
        const job = ${JSON.stringify(job)};
        const cv = document.createElement('canvas');
        cv.width = Math.round(job.w); cv.height = Math.round(job.h);
        const c = cv.getContext('2d');
        const W = cv.width, H = cv.height, S = Math.min(W, H);
        const fill = () => {
          const g = c.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
          g.addColorStop(0, '#2a1258'); g.addColorStop(1, '${BG}');
          c.fillStyle = g; c.fillRect(0, 0, W, H);
        };
        // Ball radius as a share of the shorter side. The adaptive foreground
        // must keep its art inside the central 66% that every mask shape shows.
        let share = 0.2;
        if (job.kind === 'foreground') share = 0.135;
        if (job.kind === 'splash') share = 0.11;
        if (job.kind === 'round') {
          c.beginPath(); c.arc(W / 2, H / 2, S / 2, 0, Math.PI * 2); c.clip(); fill();
        } else if (job.kind === 'square' || job.kind === 'splash') {
          fill();
        } else if (job.kind === 'web') {
          const r = S * 0.22;
          c.beginPath(); c.roundRect(0, 0, W, H, r); c.clip(); fill();
        }
        const r = S * share, gap = r * 2.12, cy = H / 2 - r * 0.08;
        drawBilliardBall(c, W / 2 - gap / 2, cy, r, WHITE_BALL);
        drawBilliardBall(c, W / 2 + gap / 2, cy, r, BLACK_BALL);
        drawImpactBoom(c, W / 2, cy, r, 20);
        if (job.opaque) {
          const px = c.getImageData(0, 0, W, H).data;
          let s = ''; for (let i = 0; i < px.length; i += 32768) s += String.fromCharCode(...px.subarray(i, i + 32768));
          return 'rgba,' + btoa(s);
        }
        return cv.toDataURL('image/png');
      })()`) as string;
      mkdirSync(dirname(job.path), { recursive: true });
      const bytes = Buffer.from(data.split(',')[1], 'base64');
      writeFileSync(job.path, job.opaque ? rgbPng(bytes, Math.round(job.w), Math.round(job.h)) : bytes);
    }
    console.log(`wrote ${jobs.length} images`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
