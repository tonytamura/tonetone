import { Game } from '../game/GameState';
import { LauncherPlayer } from '../physics/Types';
import { PhysicsConfig } from '../physics/Config';
import { uiFont } from '../graphics/Fonts';
import { ballSprite, getSpriteEpoch, inkOn } from '../graphics/Sprites';
import { kindLabel } from '../game/Rules';
import { PlayMode } from '../game/GameState';

/**
 * What the top strip shows in each mode.
 *
 * - `none` in Solo, which has one seat.
 * - `deck` against the AI: the AI's loaded ball and the one after it, so the
 *   player can see what is coming at them, and nothing else. Its score is
 *   already in the player's own strip, next to theirs, and a second
 *   scoreboard at the top would only repeat it. It is not rotated: nobody sits
 *   at the top, and the chips read in order from the player's side.
 * - `full` for two players: the top player's own strip, rotated to face them.
 */
export function topStripFor(mode: PlayMode): 'none' | 'deck' | 'full' {
  return mode === 'solo' ? 'none' : mode === 'ai' ? 'deck' : 'full';
}

export interface StripIds {
  chipNow: string;
  chipNext: string;
}

export function createStrip(
  p: LauncherPlayer,
  ids: StripIds,
  getGame: () => Game
) {
  const chipNow = document.getElementById(ids.chipNow) as HTMLCanvasElement;
  const chipNext = document.getElementById(ids.chipNext) as HTMLCanvasElement;

  function paintChip(cv2: HTMLCanvasElement, ball: any) {
    if (!cv2) return;
    const g = cv2.getContext('2d')!;
    const w = cv2.width, h = cv2.height;
    g.clearRect(0, 0, w, h);
    g.drawImage(ballSprite(ball.color, false), 0, 0, w, h);
    const game = getGame();
    if (game.showLabels) {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = uiFont(600, Math.round(w * 0.34));
      g.fillStyle = inkOn(ball.color);
      g.fillText(kindLabel(ball.kind), w / 2, h / 2);
    }
  }

  let sizeKey = 0;
  function sizeChips() {
    if (sizeKey === PhysicsConfig.R) return;
    sizeKey = PhysicsConfig.R;
    const box = (frac: number) => Math.max(12, Math.round(2 * PhysicsConfig.R * frac / 0.875)) + 'px';
    if (chipNow) { chipNow.style.width = box(0.78); chipNow.style.height = box(0.78); }
    if (chipNext) { chipNext.style.width = box(0.56); chipNext.style.height = box(0.56); }
  }

  let chipKey = '';
  function refresh() {
    sizeChips();
    const game = getGame();
    if (p.nextUp && p.then) {
      // `special` belongs in the key as much as `kind` does: black and white
      // balls both carry kind -1, so keying on kind alone let a black->white
      // swap in a slot keep repainting the previous special's colour.
      const key = p.nextUp.kind + ':' + p.nextUp.special +
                  '|' + p.then.kind + ':' + p.then.special +
                  '|' + game.showLabels +
                  '|' + getSpriteEpoch();
      if (key !== chipKey) {
        chipKey = key;
        paintChip(chipNow, p.nextUp);
        paintChip(chipNext, p.then);
      }
    }
  }

  return { sync: refresh, refresh };
}
