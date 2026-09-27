import { PlayMode, createGame, resetField, startMatch } from './game/GameState';
import { advanceFrame } from './sim/Frame';
import { createRenderContext, resizeRenderer, drawGame, drawResultsCanvas, drawTutorialRing } from './graphics/Renderer';
import { clearSpriteCache } from './graphics/Sprites';
import { createStrip } from './ui/ControlStrips';
import { setupTouchControls } from './ui/TouchControls';
import { updateHUD, endMatchUI } from './ui/HUD';
import { setupSettingsKnobs } from './ui/SettingsModal';
import { setHidden } from './ui/Dom';
import { resetStartCountdown, updateCountdown } from './ui/Countdown';
import { updateResultsEffects } from './ui/ResultsCelebration';
import { exitToMenu, onExitToMenu, setPaused, setupMatchControls } from './ui/MatchControls';
import { TUTORIAL_CLOCK, createTutorialSession } from './ui/TutorialUI';
import { settingsLine } from './game/Settings';
import { initAudio, wakeAudio, AudioStore, applyGain, fadeDroneForResults, fadeDroneForOptions, setOptionsOpenState } from './audio/SynthEngine';
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
 * Coming back to the page can also leave the sound stopped: the browser suspends
 * or interrupts the audio while the page is out of view, and may refuse to resume
 * it without a gesture. So wake it when the page is shown, and again on the first
 * gesture after that until the context reports it is running. Capture phase, so a
 * tap on the paused field or the menu counts as much as one on the game.
 */
let audioNeedsWake = false;
function onPageShown() {
  recoverGraphics();
  wakeAudio();
  audioNeedsWake = true;
}
function wakeAudioOnGesture() {
  if (!audioNeedsWake) return;
  wakeAudio();
  if (!AudioStore.actx || AudioStore.actx.state === 'running') audioNeedsWake = false;
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) onPageShown();
});
window.addEventListener('pageshow', onPageShown);
document.addEventListener('pointerup', wakeAudioOnGesture, true);
document.addEventListener('keydown', wakeAudioOnGesture, true);

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
  play: mode => setPlayers(mode),
  toMenu: () => exitToMenu(game),
});
// However the player leaves for the menu, the tutorial hands its settings back.
onExitToMenu(() => tutorial.stop());

function newMatch() {
  resetField(game, renderCtx.W, renderCtx.H);
  setPaused(game, false);
  // Hold fire for one reload so no ball leaves a launcher until the start countdown ends.
  startMatch(game, game.reloadTime);
  fadeDroneForResults(false);
  setHidden(document.getElementById('over'), true);
  resetStartCountdown();
}


setupSettingsKnobs(() => game, () => renderCtx.H || window.innerHeight);

function setPlayers(mode: PlayMode) {
  // The menu owns the audio toggle while it is up, and it writes straight to
  // AudioStore. Nothing refreshed the bar's button from that, so a match entered
  // with audio switched off in the menu still showed "Audio on".
  setSound(AudioStore.soundOn);
  game.twoPlayer = mode !== 'solo';
  game.aiOn = mode === 'ai';
  setHidden(document.getElementById('cue2'), !(game.twoPlayer && !game.aiOn));
  newMatch();
  handleResize();
}

const soundBtn = document.getElementById('sound');
function setSound(on: boolean) {
  AudioStore.soundOn = on;
  if (soundBtn) {
    soundBtn.textContent = on ? 'Audio on' : 'Audio off';
    soundBtn.setAttribute('aria-pressed', String(on));
  }
  applyGain();
}
soundBtn?.addEventListener('click', () => { initAudio(); setSound(!AudioStore.soundOn); if (AudioStore.soundOn) uiClick('confirm'); });

const panelEl = document.getElementById('panel');
const panelCloseBtn = document.getElementById('panel-close');
function showOptionsPanel() {
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
  setTimeout(() => {
    hideOptionsPanel();
  }, 550);
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
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = 'Copy these settings'; }, 2600);
    });
  }
});

// Fullscreen API fallback
const fsBtn = document.getElementById('fs');
const docEl = document.documentElement as any;
const fsRequest = docEl.requestFullscreen || docEl.webkitRequestFullscreen || null;
const fsExit = document.exitFullscreen || (document as any).webkitExitFullscreen || null;
function fsActive() { return document.fullscreenElement || (document as any).webkitFullscreenElement || null; }
function fsLabel() { if (fsBtn) fsBtn.textContent = fsActive() ? 'Exit full screen' : 'Full screen'; }
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

  tutorial.before();
  const fr = advanceFrame(game, rawDt, W, H, clock, {
    onMatchOver: g => { setPaused(g, false); endMatchUI(g, newMatch); },
  });
  clock = fr.clock;
  tutorial.after(fr.dt, fr.threw);

  if (game.matchOver && !game.paused) {
    updateResultsEffects(game, rawDt, W, H);
  }

  drawGame(renderCtx, game, clock);
  if (tutorial.isActive()) drawTutorialRing(renderCtx, tutorial.ringBalls(), clock);
  drawResultsCanvas(renderCtx, game);
  updateHUD(game, tutorial.isActive() ? TUTORIAL_CLOCK : undefined);
  refreshAllStrips();
  updateCountdown(game, rawDt);

  requestAnimationFrame(frame);
}

initMenuScreen(
  (selectedMode: PlayMode) => {
    initAudio();
    tutorial.stop();
    setPlayers(selectedMode);
  },
  () => {
    initAudio();
    tutorial.stop();
    showOptionsPanel();
    slideOutRight();
  }
);

setPlayers('solo');
if (settingsBox) settingsBox.value = settingsLine();
handleResize();
newMatch();
setTimeout(handleResize, 60);
setTimeout(handleResize, 300);
requestAnimationFrame(frame);
// `?tutorial` opens straight into the tutorial. Temporary: it is how the
// tutorial can be tried before Phase 3 gives it a real way in (the first-play
// offer and the help button). Started after the resize passes above settle,
// since the board is laid out in fractions of the field.
if (new URLSearchParams(window.location.search).has('tutorial')) {
  setTimeout(() => tutorial.start(), 350);
} else {
  showMenu();
}
