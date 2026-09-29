import { Game } from '../game/GameState';
import { t } from '../i18n/I18n';
import { uiClick } from '../audio/UiSounds';
import { fadeDroneForResults } from '../audio/SynthEngine';
import { showMenu } from './menu/MenuScreen';
import { setHidden } from './Dom';

/**
 * Pausing, and leaving a match for the main menu.
 *
 * The two belong together: the exit confirmation is a pause the player can
 * answer, so it has to be dismissed whenever the pause it rode in on is lifted.
 * Keeping them apart is what let the dialog outlive its pause.
 */

function el(id: string) {
  return document.getElementById(id);
}

export function setPaused(game: Game, paused: boolean) {
  if (game.matchOver) {
    paused = false;
  }
  game.paused = paused;
  setHidden(el('pause-overlay'), !paused);
  // Also dismiss the exit confirmation when unpausing
  if (!paused) setHidden(el('menu-confirm-overlay'), true);
  const pauseBtn = el('pause-btn');
  if (pauseBtn) {
    pauseBtn.textContent = paused ? t('bar.unpause') : t('bar.pause');
    pauseBtn.classList.toggle('is-paused', paused);
  }
}

function togglePause(game: Game) {
  const nextState = !game.paused;
  uiClick(nextState ? 'confirm' : 'cancel');
  setPaused(game, nextState);
}

/**
 * Leave the match for the main menu, from anywhere the match can be left: the
 * confirmation dialog, or the results screen. The results overlay and its
 * ducked drone outlive `matchOver`, so both have to be cleared here — otherwise
 * the menu comes up with the score card still stacked over it and the ambient
 * drone silenced until the next match starts.
 */
const menuExitListeners: (() => void)[] = [];

/**
 * Be told whenever the player leaves for the main menu, by any route. The
 * tutorial uses it to hand back the settings it borrowed.
 */
export function onExitToMenu(fn: () => void) {
  menuExitListeners.push(fn);
}

export function exitToMenu(game: Game) {
  for (const fn of menuExitListeners) fn();
  setHidden(el('menu-confirm-overlay'), true);
  setPaused(game, false);
  setHidden(el('over'), true);
  fadeDroneForResults(false);
  showMenu();
}

function showMenuConfirm(game: Game) {
  uiClick('cancel');
  // On the results screen there is no progress left to lose, and `setPaused`
  // refuses to pause once the match is over — so asking for confirmation there
  // would put up a dialog that nothing can dismiss. Leave straight away.
  if (game.matchOver) {
    exitToMenu(game);
    return;
  }
  setPaused(game, true);
  setHidden(el('menu-confirm-overlay'), false);
}

/** Wire the pause button, the pause overlay, the keyboard, and the exit dialog. */
export function setupMatchControls(game: Game) {
  el('pause-btn')?.addEventListener('click', () => togglePause(game));

  el('pause-overlay')?.addEventListener('click', () => {
    if (game.paused) {
      uiClick('confirm');
      setPaused(game, false);
    }
  });

  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'p' || e.key === 'P' || e.key === ' ') {
      if (e.key === ' ') e.preventDefault();
      togglePause(game);
    }
  });

  el('menu-btn')?.addEventListener('click', () => showMenuConfirm(game));

  el('menu-confirm-exit')?.addEventListener('click', () => {
    uiClick('confirm');
    exitToMenu(game);
  });

  el('menu-confirm-cancel')?.addEventListener('click', () => {
    uiClick('cancel');
    setHidden(el('menu-confirm-overlay'), true);
    setPaused(game, false);
  });
}
