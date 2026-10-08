/**
 * A live readout of the AI's launcher, for catching it standing still on a
 * phone: Tony saw AI3 stop on 2026-09-30, and 432 harness runs across frame
 * rates, field sizes, presets and firing modes never did. Off unless the page is
 * opened with `?aidebug`.
 *
 * What it tells apart: an aim that is not a number (reset and counted), a bay
 * that refuses every throw (blocked flashes at the AI's mouth), a bank that
 * never refills or a release held back (continuous fire), and a launcher that
 * simply has not thrown for a while (seconds since its last throw).
 */
import { Game } from '../game/GameState';
import { AI_LEVELS, aiAimRecoveries } from '../game/AI';
import { FIRE_ON_RELEASE } from '../game/Rules';
import { launchPointOf } from '../physics/LauncherBays';
import { PhysicsConfig } from '../physics/Config';

const TICK_MS = 250;

export function setupAiReadout(getGame: () => Game, size: () => { W: number; H: number }): void {
  if (typeof location === 'undefined' || !new URLSearchParams(location.search).has('aidebug')) return;
  const el = document.createElement('pre');
  el.id = 'ai-readout';
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed', left: '4px', top: 'calc(env(safe-area-inset-top, 0px) + 4px)', zIndex: '10000', margin: '0',
    padding: '4px 6px', font: '10px/1.3 monospace', color: '#fc9', background: 'rgba(0,0,0,0.7)',
    pointerEvents: 'none', whiteSpace: 'pre-wrap', maxWidth: 'calc(100vw - 8px)', boxSizing: 'border-box',
  });
  document.body.appendChild(el);

  let prevReload = 0, prevBank = 0, lastThrow = performance.now(), longest = 0;
  setInterval(() => {
    const game = getGame();
    if (!game.aiOn) { el.textContent = 'aidebug: not a vs AI match'; return; }
    const p = game.players[1];
    const now = performance.now();
    // A throw shows as the ring restarting (automatic) or the bank dropping (on release).
    const threw = FIRE_ON_RELEASE ? p.bank < prevBank : p.reload > prevReload + 0.2;
    prevReload = p.reload; prevBank = p.bank;
    // Time in the menu, the countdown's hold or a pause is not time without a
    // throw: the clock restarts whenever the match is not running.
    const live = game.matchRunning && !game.paused;
    if (threw || !live) lastThrow = now;
    const since = (now - lastThrow) / 1000;
    longest = Math.max(longest, since);
    const { W, H } = size();
    const m = launchPointOf(p, W, H);
    const nearMouth = (f: { x: number; y: number }) => Math.hypot(f.x - m.x, f.y - m.y) < PhysicsConfig.R * 6;
    const blocked = game.flashes.filter(f => f.kind === 'blocked' && nearMouth(f)).length;
    const st = (p as any)._ai ?? {};
    el.textContent = [
      `${AI_LEVELS[game.aiLevel]?.label ?? 'classic'}  fire ${FIRE_ON_RELEASE ? 'release' : 'auto'}  ${game.matchRunning ? 'running' : 'stopped'}${game.paused ? ' paused' : ''}${game.matchOver ? ' over' : ''}`,
      `aim ${p.aimDeg.toFixed(1)}  power ${p.strength.toFixed(2)}  reload ${p.reload.toFixed(2)}  bank ${p.bank}  hold ${p.hold.toFixed(1)}${p.holdFire ? '  planning' : ''}`,
      `since throw ${since.toFixed(1)}s (longest ${longest.toFixed(1)}s)  blocked ${blocked}  target ${st.key ?? '-'}`,
      `balls ${game.balls.length} (live ${game.balls.filter(b => !b.ghost).length})  groups ${game.groups.length}  NaN resets ${aiAimRecoveries()}`,
    ].join('\n');
  }, TICK_MS);
}
