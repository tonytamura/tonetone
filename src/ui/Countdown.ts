import { Game } from '../game/GameState';
import { t } from '../i18n/I18n';
import { playCountdownTick } from '../audio/Voices';
import { setHidden } from './Dom';

/**
 * The two countdowns shown in the player cue bars: the one that runs the field
 * in at the start of a match, and the last ten seconds of the clock.
 *
 * Both take over the same strip as the match time, so they share one place that
 * decides which of the two is showing. The elapsed time and the last text drawn
 * used to be module state in `main.ts`; they belong to the countdown alone, and
 * nothing outside it reads them.
 */

/** Tracks the last text shown so we only re-trigger the pop animation on change. */
let lastText = '';
/** Seconds since match reset; -1 = inactive. */
let startElapsed = -1;
/**
 * What the strip shows now. This runs every frame, and rewriting the same
 * classes each time stripped `pop` one frame after it was added, cutting the
 * 0.9s pop animation short, and cost five DOM writes a frame all match long.
 */
let shown = '';

/** Start the run-in countdown over, as a new match does. */
export function resetStartCountdown() {
  startElapsed = 0;
  lastText = '';
  shown = '';
}

/** Stop the run-in countdown and show the match time, as the tutorial wants. */
export function clearCountdown(game: Game) {
  startElapsed = -1;
  setCdText(game, '', 'start');
  lastText = '';
}

/** Apply text + classes to both countdown bar elements (hiding the time display
 *  when active, and only driving cd2El when in two-player mode). */
function setCdText(game: Game, text: string, cls: 'start' | 'go' | 'end') {
  const key = text + '|' + cls + '|' + game.twoPlayer;
  if (key === shown) return;
  shown = key;
  const cd1El = document.getElementById('countdown1');
  const cd2El = document.getElementById('countdown2');
  const els = game.twoPlayer ? [cd1El, cd2El] : [cd1El];
  const time1El = document.getElementById('time1');
  const time2El = document.getElementById('time2');

  for (const el of [cd1El, cd2El]) {
    if (!el) continue;
    setHidden(el, true);
    el.classList.remove('end', 'go', 'pop');
  }
  setHidden(time1El, false);
  setHidden(time2El, false);

  if (text === '') return; // nothing to show

  setHidden(time1El, true);
  if (game.twoPlayer) setHidden(time2El, true);

  for (const el of els) {
    if (!el) continue;
    setHidden(el, false);
    if (cls === 'end') el.classList.add('end');
    if (cls === 'go')  el.classList.add('go');
    if (text !== lastText) {
      el.classList.remove('pop');
      void el.offsetWidth; // force reflow to restart animation
      el.classList.add('pop');
      el.textContent = text;
      // Play countdown tick once per text change (only on the first element to avoid double-fire)
      if (el === els[0]) {
        playCountdownTick({ isGo: cls === 'go' || (cls === 'end' && text === '0') });
      }
    }
  }
  lastText = text;
}

/**
 * Advance the run-in countdown by `dt` and draw whichever countdown is due.
 *
 * A paused match does not advance: the run-in is there to give the player time
 * to look at the field, and pausing through it would otherwise burn it off.
 */
export function updateCountdown(game: Game, dt: number) {
  if (startElapsed >= 0 && !game.paused) startElapsed += dt;

  const reloadSecs = game.reloadTime;

  // ── Start countdown (reloadTime → 1 → Start!) ─────────────────────────
  if (startElapsed >= 0 && !game.matchOver) {
    const left = reloadSecs - startElapsed;
    if (left > 0) {
      setCdText(game, Math.ceil(left).toString(), 'start');
      return;
    } else if (startElapsed < reloadSecs + 1) {
      setCdText(game, t('countdown.start'), 'go');
      return;
    } else {
      startElapsed = -1; // done
    }
  }

  // ── End-of-match countdown (last 10 s) ────────────────────────────────
  if (game.matchLen > 0 && game.matchRunning && !game.matchOver) {
    const left = Math.max(0, game.matchLen - game.matchT);
    if (left <= 10) {
      setCdText(game, left <= 0 ? '0' : Math.ceil(left).toString(), 'end');
      return;
    }
  }

  // Nothing to show — restore time displays
  setCdText(game, '', 'start');
  lastText = '';
}
