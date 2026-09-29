/**
 * Does the bottom strip (and the top one in two-player) still fit on a phone?
 *
 * Starts the dev server, opens each mode on each screen in Chromium, freezes
 * the frame loop, and fills every strip with the widest thing it can hold:
 * 9999 against 9999 and a 20:00 clock. Then checks that every score, the chips
 * and the clock are on screen, on one row, unwrapped and not overlapping.
 *
 *   npm run check:strip
 *
 * It needs a browser, so it is not part of `npm run verify`. Set CHROME to a
 * Chromium executable if Playwright cannot find one by itself.
 *
 * Written 2026-09-28, when scores past 1000 on both sides pushed the clock off
 * a 390px phone. Before the fix 8 of the 20 strips checked here failed; the
 * clock was up to 38px off screen at 320px.
 */
import { createServer } from 'vite';
import { chromium, Page } from 'playwright-core';
import { LANGUAGES } from '../src/i18n/I18n';

const SCREENS: [number, number][] = [[320, 568], [360, 740], [390, 844], [412, 915], [1280, 720]];
// The menu action behind each mode's button: its words change with the language.
const MODES: [string, string][] = [['solo', 'solo'], ['ai', 'one_player'], ['duel', 'two_player']];
// Every language on the narrowest screen, where a longer "YOU" bites first;
// English alone on the rest.
const NARROWEST: [number, number] = SCREENS[0];
const OTHER_LANGUAGES = LANGUAGES.map(l => l.id).filter(id => id !== 'en');
const WIDEST_SCORE = '9999';
const WIDEST_CLOCK = '20:00'; // the `match` knob's maximum

interface Box { what: string; l: number; r: number; t: number; b: number; lines: number }

async function tapMenu(page: Page, action: string) {
  // Ask the game's own layout where the button is. Sent as a string: vite-node
  // would otherwise rewrite the dynamic import for Node before it reached the page.
  const p = await page.evaluate(`(async () => {
    const { computeMenuLayout } = await import('/src/ui/menu/MenuLayout.ts');
    const l = computeMenuLayout(innerWidth, innerHeight, document.createElement('canvas').getContext('2d'));
    const b = l.buttons.find(b => b.action === ${JSON.stringify(action)});
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  })()`) as { x: number; y: number };
  await page.mouse.click(p.x, p.y);
}

/** What is wrong with one strip, or nothing. */
export function stripProblems(boxes: Box[], viewportWidth: number): string[] {
  const bad: string[] = [];
  for (const r of boxes) {
    if (r.l < -0.5 || r.r > viewportWidth + 0.5) bad.push(`${r.what} off screen (${Math.round(r.l)}..${Math.round(r.r)})`);
    if (r.lines > 1) bad.push(`${r.what} wraps`);
  }
  const mids = boxes.map(r => (r.t + r.b) / 2);
  if (Math.max(...mids) - Math.min(...mids) > 12) bad.push('not on one row');
  const sorted = [...boxes].sort((a, b) => a.l - b.l);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].l < sorted[i - 1].r - 0.5) bad.push(`${sorted[i - 1].what} overlaps ${sorted[i].what}`);
  }
  return bad;
}

async function main() {
  const server = await createServer({ server: { port: 0 }, logLevel: 'silent' });
  await server.listen();
  const address = server.httpServer!.address();
  const url = `http://localhost:${typeof address === 'object' && address ? address.port : 5173}/`;
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  let failures = 0;
  try {
    const runs: [number, number, string][] = [];
    for (const [w, h] of SCREENS) {
      for (const lang of w === NARROWEST[0] && h === NARROWEST[1] ? ['en', ...OTHER_LANGUAGES] : ['en']) runs.push([w, h, lang]);
    }
    for (const [w, h, lang] of runs) {
      for (const [mode, action] of MODES) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h } });
        // Straight into the mode, and against the AI with the widest name on
        // the ladder, AGI.
        await ctx.addInitScript(() => {
          localStorage.setItem('toneboom.tutorial', 'done');
          localStorage.setItem('toneboom.ladder', JSON.stringify({ v: 1, level: 3 }));
        });
        const page = await ctx.newPage();
        await page.goto(`${url}?lang=${lang}`);
        await page.waitForTimeout(1200);
        await tapMenu(page, action);
        await page.waitForTimeout(400);
        if (mode === 'duel') { await page.click('#seat-top'); await page.click('#seat-bottom'); }
        await page.waitForTimeout(4200); // past the 3, 2, 1 countdown
        const strips = await page.evaluate(([score, clock]) => {
          window.requestAnimationFrame = () => 0; // freeze the HUD so it keeps what is written
          for (const n of document.querySelectorAll('.score-num')) n.textContent = score;
          for (const id of ['time1', 'time2']) { const t = document.getElementById(id); if (t) t.textContent = clock; }
          const shown = (e: Element | null) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
          const out: { cue: string; boxes: Box[] }[] = [];
          for (const id of ['cue', 'cue2']) {
            const cue = document.getElementById(id);
            if (!shown(cue)) continue;
            const parts = [...cue!.querySelectorAll('.score-p1 b, .score-p2 b, .chips, .bar-time b')].filter(shown);
            out.push({
              cue: id,
              boxes: parts.map(p => {
                const r = p.getBoundingClientRect();
                return { what: p.id || p.className, l: r.left, r: r.right, t: r.top, b: r.bottom, lines: p.getClientRects().length };
              }),
            });
          }
          return out;
        }, [WIDEST_SCORE, WIDEST_CLOCK]);
        for (const { cue, boxes } of strips) {
          const bad = stripProblems(boxes, w);
          if (bad.length) failures++;
          console.log(`${`${w}x${h}`.padEnd(9)} ${lang} ${mode.padEnd(4)} ${cue.padEnd(4)} ${bad.length ? 'FAIL ' + bad.join('; ') : 'ok'}`);
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(failures ? `\n${failures} strip(s) do not fit.` : '\nEvery strip fits.');
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
