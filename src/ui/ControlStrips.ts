import { Game } from '../game/GameState';
import { LauncherPlayer } from '../physics/Types';
import { PhysicsConfig } from '../physics/Config';
import { ballSprite, getSpriteEpoch, SP_R, SPRITE } from '../graphics/Sprites';
import { drawBallMark, marksShown } from '../graphics/BallMarks';
import { FIRE_ON_RELEASE } from '../game/Rules';
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

  /** Paint `ball` on a chip, or leave it empty: under continuous fire a chip is a banked ball, and a short bank has none there. */
  function paintChip(cv2: HTMLCanvasElement, ball: any) {
    if (!cv2) return;
    const g = cv2.getContext('2d')!;
    const w = cv2.width, h = cv2.height;
    g.clearRect(0, 0, w, h);
    if (!ball) return;
    g.drawImage(ballSprite(ball.color, false), 0, 0, w, h);
    const game = getGame();
    // The sprite's ball spans SP_R of its SPRITE/2 half-width.
    if (marksShown(game.marks)) drawBallMark(g, ball.kind, w / 2, h / 2, (w / 2) * (2 * SP_R / SPRITE), ball.color);
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
      // Under continuous fire the launcher's ball and the two chips are the
      // bank itself, in throwing order: a chip shows its ball only while the
      // bank reaches it, so a burst empties them from the far end.
      const banked = FIRE_ON_RELEASE ? p.bank : 3;
      const key = p.nextUp.kind + ':' + p.nextUp.special +
                  '|' + p.then.kind + ':' + p.then.special +
                  '|' + marksShown(game.marks) +
                  '|' + Math.min(3, banked) +
                  '|' + getSpriteEpoch();
      if (key !== chipKey) {
        chipKey = key;
        paintChip(chipNow, banked >= 2 ? p.nextUp : null);
        paintChip(chipNext, banked >= 3 ? p.then : null);
      }
    }
  }

  return { sync: refresh, refresh };
}
