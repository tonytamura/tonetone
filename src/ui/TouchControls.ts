import { Game } from '../game/GameState';
import { LauncherPlayer } from '../physics/Types';
import { aimAt } from '../physics/LauncherBays';
import { initAudio } from '../audio/SynthEngine';
import { FIRE_ON_RELEASE } from '../game/Rules';

export function setupTouchControls(
  canvas: HTMLCanvasElement,
  getGame: () => Game,
  syncStrips: () => void
) {
  const owners = new Map<number, LauncherPlayer>();

  function playerForTouch(y: number, height: number, game: Game): LauncherPlayer | null {
    if (!game.twoPlayer) return game.players[0];
    const p = y < height / 2 ? game.players[1] : game.players[0];
    if (game.aiOn && p === game.players[1]) return null;
    return p;
  }

  function pointAt(e: PointerEvent, p: LauncherPlayer, height: number, width: number) {
    const r = canvas.getBoundingClientRect();
    aimAt(p, e.clientX - r.left, e.clientY - r.top, width, height, getGame().twoPlayer);
    syncStrips();
  }

  canvas.addEventListener('pointerdown', e => {
    const game = getGame();
    if (game.paused) return;
    initAudio();
    const r = canvas.getBoundingClientRect();
    const height = r.height || window.innerHeight;
    const width = r.width || window.innerWidth;
    const p = playerForTouch(e.clientY - r.top, height, game);
    if (!p) return;

    for (const held of owners.values()) if (held === p) return;
    owners.set(e.pointerId, p);
    pointAt(e, p, height, width);
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', e => {
    const game = getGame();
    if (game.paused) return;
    const p = owners.get(e.pointerId);
    if (p) {
      const r = canvas.getBoundingClientRect();
      pointAt(e, p, r.height || window.innerHeight, r.width || window.innerWidth);
    }
  });

  // `throws`: a finger lifted throws, under continuous fire. A cancelled touch
  // (the system taking the gesture, a palm) only ends the aim.
  const release = (e: PointerEvent, throws: boolean) => {
    const p = owners.get(e.pointerId);
    if (!p) return;
    owners.delete(e.pointerId);
    const r = canvas.getBoundingClientRect();
    pointAt(e, p, r.height || window.innerHeight, r.width || window.innerWidth);
    const game = getGame();
    // The frame loop throws it: one ball per release, as many as the bank holds.
    if (throws && FIRE_ON_RELEASE && !game.paused && !game.matchOver) p.releases = Math.min(p.bank, p.releases + 1);
  };

  canvas.addEventListener('pointerup', e => release(e, true));
  canvas.addEventListener('pointercancel', e => release(e, false));
  canvas.addEventListener('lostpointercapture', e => release(e, false));
}
