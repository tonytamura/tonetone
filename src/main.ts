import { PlayMode, createGame, resetField, startMatch } from './game/GameState';
import { isLangId, onLanguageChange, setLanguage, startingLanguage, t } from './i18n/I18n';
import { setupLanguagePicker } from './ui/LanguagePicker';
import { setupRecordsScreen } from './ui/RecordsScreen';
import { recordWords } from './ui/RecordsCelebration';
import { isNativeApp } from './ui/Platform';
import { setupAudioReadout } from './ui/AudioReadout';
import { setupAiReadout } from './ui/AiReadout';
import { advanceFrame } from './sim/Frame';
import { createRenderContext, resizeRenderer, drawGame, drawResultsCanvas, drawTutorialRing, drawTutorialHint } from './graphics/Renderer';
import { clearSpriteCache } from './graphics/Sprites';
import { createStrip, topStripFor } from './ui/ControlStrips';
import { setupTouchControls } from './ui/TouchControls';
import { updateHUD, endMatchUI } from './ui/HUD';
import { presetChoices, presetLabel } from './ui/PlayerSettings';
import { setupSettingsKnobs } from './ui/SettingsModal';
import { setHidden } from './ui/Dom';
import { resetStartCountdown, updateCountdown } from './ui/Countdown';
import { startResultsEffects, updateResultsEffects } from './ui/ResultsCelebration';
import { exitToMenu, onExitToMenu, setPaused, setupMatchControls } from './ui/MatchControls';
import { TUTORIAL_CLOCK, createTutorialSession } from './ui/TutorialUI';
import { createSeatCard, needsSeatCard } from './ui/SeatCard';
import { createFirstPlayOffer, setupHelpScreen, shouldOfferTutorial } from './ui/FirstPlay';
import { hasSeenTutorial, markTutorialSeen } from './ui/Progress';
import {
  ResultNotes, ladderNotes, loadLadderLevel, loadRecords, recordMatch, recordSections, saveLadderLevel, soloRecordNotes, submitScore,
} from './ui/Records';
import { AI_LEVELS, ladderStep } from './game/AI';
import { setPlannerBudget } from './game/AIPlanner';
import { FORCED_AI_LEVEL } from './game/AIChoice';
import { settingsLine } from './game/Settings';
import { initAudio, audioReturned, checkAudioOnGesture, sleepAudio, AudioStore, applyGain, fadeDroneForResults, fadeDroneForOptions, setOptionsOpenState } from './audio/SynthEngine';
import { uiClick } from './audio/UiSounds';
import { initMenuScreen, showMenu, hideMenu, isMenuOccluding, slideOutRight, slideInFromRight } from './ui/menu/MenuScreen';

const stageEl = document.getElementById('stage') as HTMLElement;
const cv = document.getElementById('c') as HTMLCanvasElement;
const renderCtx = createRenderContext(cv);
const game = createGame();

function handleResize() {
  resizeRenderer(renderCtx, stageEl);
}

window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => setTimeout(handleResize, 60));

if (window.ResizeObserver) {
  new ResizeObserver(() => handleResize()).observe(stageEl);
}
// Moving the window to a screen of another pixel density, or zooming, changes
// the ratio at the same CSS size: no resize fires, and the field went blurry.
function watchPixelRatio() {
  if (!window.matchMedia) return;
  window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    .addEventListener?.('change', () => { handleResize(); watchPixelRatio(); }, { once: true });
}
watchPixelRatio();
if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
  document.fonts.ready.then(handleResize);
}

/**
 * Chrome can drop a 2D canvas's backing store while the tab is in the
 * background. The context comes back reset: the DPR transform is gone, so the
 * field draws into the top-left quarter with stale pixels around it, and the
 * cached sprite canvases are blank, so the balls and the liquid glow vanish.
 * Nothing about the size changed, so an ordinary resize cannot see it — rebuild
 * the sprites and re-apply sizing unconditionally.
 */
function recoverGraphics() {
  clearSpriteCache();
  resizeRenderer(renderCtx, stageEl, true);
}
for (const c of [cv, renderCtx.resCv, renderCtx.bg]) {
  c?.addEventListener('contextrestored', recoverGraphics);
}
/**
 * Leaving the page puts the sound to sleep and coming back wakes it; the first
 * gesture afterwards checks it is really playing and rebuilds it if not. See
 * "Leaving the page and coming back" in `audio/SynthEngine.ts`. Capture phase,
 * so a tap on the paused field or the menu counts as much as one on the game.
 */
function onPageShown() {
  recoverGraphics();
  audioReturned();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) sleepAudio();
  else onPageShown();
});
window.addEventListener('pagehide', sleepAudio);
window.addEventListener('pageshow', onPageShown);
document.addEventListener('pointerup', checkAudioOnGesture, true);
document.addEventListener('keydown', checkAudioOnGesture, true);
setupAudioReadout();
setupAiReadout(() => game, () => ({ W: renderCtx.W || window.innerWidth, H: renderCtx.H || window.innerHeight }));

const strip1 = createStrip(
  game.players[0],
  { chipNow: 'chipNow', chipNext: 'chipNext' },
  () => game
);

const strip2 = createStrip(
  game.players[1],
  { chipNow: 'chipNow2', chipNext: 'chipNext2' },
  () => game
);

function syncAllStrips() {
  strip1.sync();
  strip2.sync();
}

function refreshAllStrips() {
  strip1.refresh();
  strip2.refresh();
}

setupTouchControls(cv, () => game, syncAllStrips);
setupMatchControls(game);

const tutorial = createTutorialSession({
  game,
  canvas: cv,
  size: () => ({ W: renderCtx.W || window.innerWidth, H: renderCtx.H || window.innerHeight }),
  prepare: () => {
    // A solo stage: the top strip goes, so the field is measured without it
    // before the tutorial lays its board out in fractions of that field.
    // The menu is an opaque cover, and the frame loop does not run under it.
    hideMenu();
    setPaused(game, false);
    setHidden(document.getElementById('over'), true);
    setHidden(document.getElementById('cue2'), true);
    fadeDroneForResults(false);
    handleResize();
  },
  play: mode => startMode(mode),
  toMenu: () => exitToMenu(game),
  onDone: () => markTutorialSeen(),
});
// However the player leaves for the menu, the tutorial hands its settings back.
onExitToMenu(() => tutorial.stop());

function newMatch() {
  // Against the AI, the rung the last result moved the ladder to (Play again
  // included). Read here, not when the result is decided, so the results card
  // still names the AI that was just played.
  // A level forced in Options (Custom) wins over the ladder's.
  if (game.aiOn) game.aiLevel = FORCED_AI_LEVEL > 0 ? FORCED_AI_LEVEL - 1 : loadLadderLevel(AI_LEVELS.length);
  resetField(game, renderCtx.W, renderCtx.H);
  setPaused(game, false);
  // Hold fire for one reload so no ball leaves a launcher until the start countdown ends.
  startMatch(game, game.reloadTime);
  fadeDroneForResults(false);
  setHidden(document.getElementById('over'), true);
  resetStartCountdown();
}


// The planning AIs spread their thinking over the frames before a throw, at
// most this long per frame, so a slow device thinks less rather than stutters.
setPlannerBudget(4);

const settings = setupSettingsKnobs(() => game, () => renderCtx.H || window.innerHeight);
// A duel's winner picks the next match's mode on the results card.
// Named when the match ends, so the names are in whatever language is in force then.
const duelModes = () => ({ choices: presetChoices(), current: settings.choice, pick: settings.choose });

/**
 * The two-player seat card. While it is up the field waits: nothing moves and
 * the start countdown does not run until both halves are ready.
 */
const seatCard = createSeatCard(() => { /* the frame loop resumes by itself */ });

/**
 * Start a match in `mode` from the menu or the tutorial: a two-player match
 * opens with the seat card. "Play again" calls `newMatch` directly and so skips
 * it, since it is the same pair in the same seats.
 */
function startMode(mode: PlayMode) {
  setPlayers(mode);
  if (needsSeatCard(mode)) seatCard.show();
}

const firstPlay = createFirstPlayOffer({
  showMe: mode => tutorial.start({ then: mode }),
  // Skipping is an answer too: the offer is not made again on this device.
  skip: mode => { markTutorialSeen(); if (needsSeatCard(mode)) seatCard.show(); },
});

setupHelpScreen(() => tutorial.start({ then: null }));
setupRecordsScreen(
  () => recordSections(loadRecords(), presetChoices(), AI_LEVELS, loadLadderLevel(AI_LEVELS.length)),
  () => recordWords(loadRecords(), AI_LEVELS),
);

/**
 * What a finished match does to the records, and what the results card says
 * about it. A solo match puts its score against that mode's best, a Custom
 * slot's included; a two-player match counts a win or a draw for its mode; a
 * vs AI match counts one against its AI and moves the ladder. Only here, where
 * a real match ends, so the harness and the tutorial never touch the records.
 */
function resultNotes(g: typeof game): ResultNotes | undefined {
  const mode = settings.choice();
  if (g.aiOn) return ladderResult(g, settings.activePreset());
  if (g.twoPlayer) {
    recordMatch('duel', mode, g.players[0].score, g.players[1].score);
    return undefined;
  }
  return soloRecordNotes(submitScore('solo', mode, g.players[0].score), presetLabel(mode));
}

/**
 * A vs AI match counts in that AI's tally, and moves the ladder: a win one rung
 * up, a loss one down (a loss to AGI, Game Over, all the way back to AI1), a
 * draw nowhere. The next match, Play again included, is against the new rung.
 * The best score against each AI counts on a named preset only: a Custom
 * slot's match could be twenty minutes long.
 */
function ladderResult(g: typeof game, preset: string | null): ResultNotes {
  const played = AI_LEVELS[g.aiLevel];
  const mine = g.players[0].score, theirs = g.players[1].score;
  // Every match against an AI counts in its tally, a fixed one's too: the win
  // was real, even if the ladder does not move for it.
  recordMatch('vsAi', played.id, mine, theirs);
  // Forced in Options, to feel one level: the ladder stays where it was.
  if (FORCED_AI_LEVEL > 0) return { lines: [t('ladder.forced', { ai: played.label })] };
  const next = ladderStep(g.aiLevel, mine, theirs);
  const direction = next > g.aiLevel ? 'up' : next < g.aiLevel ? 'down' : 'stay';
  const atTop = mine > theirs && g.aiLevel === AI_LEVELS.length - 1;
  const record = preset ? submitScore('ai', played.id, mine) : { isNew: false, best: 0, previous: null };
  saveLadderLevel(next);
  return ladderNotes(played.label, AI_LEVELS[next].label, direction, atTop, record);
}

// Leaving for the menu takes down whatever the field was waiting behind.
onExitToMenu(() => { firstPlay.dismiss(); seatCard.dismiss(); });

/** Something is up in front of the field that it has to wait for. */
function fieldHeld(): boolean {
  return firstPlay.isOpen() || seatCard.isActive();
}

function setPlayers(mode: PlayMode) {
  // The menu owns the audio toggle while it is up, and it writes straight to
  // AudioStore. Nothing refreshed the bar's button from that, so a match entered
  // with audio switched off in the menu still showed "Audio on".
  setSound(AudioStore.soundOn);
  game.twoPlayer = mode !== 'solo';
  game.aiOn = mode === 'ai';
  const top = topStripFor(mode);
  const cue2 = document.getElementById('cue2');
  setHidden(cue2, top === 'none');
  cue2?.classList.toggle('deck-only', top === 'deck');
  cue2?.classList.toggle('flip', top === 'full');
  newMatch();
  handleResize();
}

const soundBtn = document.getElementById('sound');
function setSound(on: boolean) {
  AudioStore.soundOn = on;
  if (soundBtn) {
    soundBtn.textContent = on ? t('menu.audioOn') : t('menu.audioOff');
    soundBtn.setAttribute('aria-pressed', String(on));
  }
  applyGain();
}
// The bar's labels are set in code, not markup, so a new language writes them again.
onLanguageChange(() => {
  if (soundBtn) soundBtn.textContent = AudioStore.soundOn ? t('menu.audioOn') : t('menu.audioOff');
  fsLabel();
});
soundBtn?.addEventListener('click', () => { initAudio(); setSound(!AudioStore.soundOn); if (AudioStore.soundOn) uiClick('confirm'); });

const panelEl = document.getElementById('panel');
const panelCloseBtn = document.getElementById('panel-close');
// The panel hides 550ms after Back, once the menu has slid in over it. Opening
// Options again inside that window left the old timer to hide the new panel,
// with the menu slid away: a blank screen nothing could leave.
let panelHideTimer: ReturnType<typeof setTimeout> | undefined;
function showOptionsPanel() {
  clearTimeout(panelHideTimer);
  setOptionsOpenState(true);
  fadeDroneForOptions(true);
  setHidden(panelEl, false);
}
function hideOptionsPanel() {
  setOptionsOpenState(false);
  fadeDroneForOptions(false);
  setHidden(panelEl, true);
}
panelCloseBtn?.addEventListener('click', () => {
  uiClick('cancel');
  slideInFromRight();
  clearTimeout(panelHideTimer);
  panelHideTimer = setTimeout(hideOptionsPanel, 550);
});

const copyBtn = document.getElementById('copy') as HTMLButtonElement;
const settingsBox = document.getElementById('settings') as HTMLTextAreaElement;
copyBtn?.addEventListener('click', () => {
  const line = settingsLine();
  if (settingsBox) {
    settingsBox.value = line;
    settingsBox.focus();
    if (settingsBox.setSelectionRange) settingsBox.setSelectionRange(0, line.length);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(line).then(() => {
      copyBtn.textContent = t('panel.copied');
      setTimeout(() => { copyBtn.textContent = t('panel.copy'); }, 2600);
    });
  }
});

// Fullscreen API fallback
const fsBtn = document.getElementById('fs');
const docEl = document.documentElement as any;
// Web only: the Android and iOS apps are full screen already.
const fsRequest = isNativeApp() ? null : docEl.requestFullscreen || docEl.webkitRequestFullscreen || null;
const fsExit = document.exitFullscreen || (document as any).webkitExitFullscreen || null;
function fsActive() { return document.fullscreenElement || (document as any).webkitFullscreenElement || null; }
function fsLabel() { if (fsBtn) fsBtn.textContent = fsActive() ? t('menu.exitFullScreen') : t('menu.fullScreen'); }
if (!fsRequest && fsBtn) {
  setHidden(fsBtn, true);
} else if (fsBtn) {
  fsBtn.addEventListener('click', () => {
    try {
      if (fsActive()) { if (fsExit) fsExit.call(document); }
      else { fsRequest.call(docEl); }
    } catch (e) {}
  });
  document.addEventListener('fullscreenchange', () => { fsLabel(); handleResize(); });
}

// Game Loop
let lastTime = performance.now() / 1000;
let clock = 0;

function frame(ts: number) {
  const t = ts / 1000;
  const rawDt = t - lastTime;
  lastTime = t;

  // The menu is an opaque full-screen overlay that runs its own render loop.
  // Simulating and drawing the game underneath it is invisible work — a full
  // physics step, a full canvas render, seven innerHTML writes and both control
  // strips, every frame — and the main-thread time it costs is what starves the
  // Web Audio thread and makes the menu crackle. `lastTime` is still advanced
  // above, so the first live frame after the menu closes gets a normal dt.
  if (isMenuOccluding()) {
    requestAnimationFrame(frame);
    return;
  }

  const W = renderCtx.W || window.innerWidth;
  const H = renderCtx.H || window.innerHeight;

  // Held behind the first-play offer or the seat card, the field is drawn but
  // does not move, and the start countdown does not run.
  const held = fieldHeld();
  let simDt = 0;
  if (!held) {
    tutorial.before();
    const fr = advanceFrame(game, rawDt, W, H, clock, {
      onMatchOver: g => { setPaused(g, false); startResultsEffects(); endMatchUI(g, newMatch, resultNotes(g), duelModes()); },
    });
    clock = fr.clock;
    simDt = fr.dt;
    tutorial.after(fr.dt, fr.threw);
  }

  if (game.matchOver && !game.paused) {
    updateResultsEffects(game, rawDt, W, H);
  }

  drawGame(renderCtx, game, clock);
  if (tutorial.isActive()) {
    drawTutorialRing(renderCtx, tutorial.ringBalls(), clock);
    drawTutorialHint(renderCtx, tutorial.hint(), clock);
  }
  drawResultsCanvas(renderCtx, game);
  updateHUD(game, tutorial.isActive() ? TUTORIAL_CLOCK : undefined);
  refreshAllStrips();
  // On the simulation's dt, which holds the launchers: on raw time a hitch
  // during the countdown (or a slow device) showed Start! before they let go.
  if (!held) updateCountdown(game, simDt);

  requestAnimationFrame(frame);
}

initMenuScreen(
  (selectedMode: PlayMode) => {
    initAudio();
    tutorial.stop();
    if (shouldOfferTutorial(hasSeenTutorial(), selectedMode)) {
      // The chosen mode's field is set up and held behind the offer, so Skip
      // goes straight into it.
      setPlayers(selectedMode);
      firstPlay.show(selectedMode);
    } else {
      startMode(selectedMode);
    }
  },
  () => {
    initAudio();
    tutorial.stop();
    showOptionsPanel();
    slideOutRight();
  }
);

setupLanguagePicker();
// Start in the language saved on the flag button, else the device's, else
// English. `?lang=de` forces one for testing, without saving it. The page stays
// hidden until the words have loaded, rather than flashing English first.
{
  const reveal = () => document.documentElement.classList.remove('i18n-loading');
  setTimeout(reveal, 1500);
  const forced = new URLSearchParams(window.location.search).get('lang');
  void setLanguage(isLangId(forced) ? forced : startingLanguage()).finally(reveal);
}

setPlayers('solo');
if (settingsBox) settingsBox.value = settingsLine();
handleResize();
newMatch();
setTimeout(handleResize, 60);
setTimeout(handleResize, 300);
requestAnimationFrame(frame);
// `?tutorial` opens straight into the tutorial, ending on "Back to menu";
// `?tutorial=solo` (or `ai`, `duel`) ends on "Start game" into that mode, as the
// first-play offer does. Kept as a way to reach it directly for testing, since
// the real ways in — the offer and the help button — each need a menu tap.
// Started after the resize passes above settle, since the board is laid out in
// fractions of the field.
const tutorialParam = new URLSearchParams(window.location.search).get('tutorial');
if (tutorialParam !== null) {
  const then = (['solo', 'ai', 'duel'] as PlayMode[]).find(m => m === tutorialParam) ?? null;
  setTimeout(() => tutorial.start({ then }), 350);
} else {
  showMenu();
}
