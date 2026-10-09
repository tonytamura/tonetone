import { AudioStore, applyGain, isOptionsOpen } from '../../audio/SynthEngine';
import { onLanguageChange } from '../../i18n/I18n';
import { isNativeApp } from '../Platform';
import { clickHz, initMenuAudio, lastSelectAt, playBinauralClick, playHoverClick } from '../../audio/UiSounds';
import { PlayMode } from '../../game/GameState';
import { clearSpriteCache } from '../../graphics/Sprites';
import { uiFont } from '../../graphics/Fonts';
import { BLACK, MENU_CYAN, MENU_PINK_DEEP, PINK, WHITE, WHITE_HEX, hex, rgba } from '../../graphics/Palette';
import { setHidden } from '../Dom';
import { MenuLayout, buttonIndexAt, computeMenuLayout, menuItems } from './MenuLayout';
import { clearMenuPops, drawBackground, drawMenuBalls, drawMenuFlashes, drawMenuPops, initAmbience } from './MenuAmbience';
import { drawLogo } from './LogoArt';

/**
 * The menu's lifecycle: showing and hiding it, sizing its canvas, tracking the
 * pointer, and running the frame loop that draws it.
 *
 * What it draws is elsewhere — the backdrop and the attract animations in
 * `MenuAmbience`, the wordmark in `LogoArt`, the geometry in `MenuLayout` — so
 * this file holds the buttons and the state that only a live screen has.
 */

export type { MenuItem, ButtonRect, MenuLayout } from './MenuLayout';
export { computeMenuLayout } from './MenuLayout';

let menuContainer: HTMLElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let audioBtn: HTMLButtonElement | null = null;
let fsBtn: HTMLButtonElement | null = null;

let width = 0;
let height = 0;
let dpr = 1;
let animFrame = 0;
let animationId = 0;
let menuActive = false;
let isTransitioning = false;

let onModeSelectCallback: ((mode: PlayMode) => void) | null = null;
let onOptionsCallback: (() => void) | null = null;

/**
 * Where the pointer is, whether it is pressed, and whether it is a mouse.
 *
 * `isMouse` is what splits the two input stories. A mouse hovers without
 * pressing, so it highlights and sounds as it moves and chooses on the way down.
 * A finger cannot hover: it lands, slides, and lifts, so it highlights silently
 * while it is down and chooses on the way up, over whichever button it is on.
 * Parked off-screen means nothing is highlighted.
 */
const pointer = { x: -1000, y: -1000, isDown: false, isMouse: true };

/** Move the pointer where no button is, so the highlight clears. */
function parkPointer() {
  pointer.x = -1000;
  pointer.y = -1000;
}
let activeHoverIndex = -1;
let clickedItemIndex = -1;
let lastInteractionTimestamp = 0;

/**
 * How long the menu ignores a second press.
 *
 * This is input debounce, not the audio click lock in `audio/UiSounds.ts` — the
 * two happen to be the same 180ms, and are separate numbers because one guards
 * a double-tap and the other guards the Web Audio thread.
 */
const INTERACTION_DEBOUNCE_MS = 180;

/** How long the slide-out animation in `index.css` runs. */
const SLIDE_MS = 550;

/** How long a pressed button is held lit before the screen changes. */
const PRESS_HOLD_MS = 120;

/** A hover blip is skipped this soon after a selection or a press. */
const HOVER_QUIET_MS = 350;

// ── Buttons ────────────────────────────────────────────────────────────

/** The frequency a hover blip starts at, climbing by item. */
const HOVER_BASE_HZ = 220;
const HOVER_STEP_HZ = 30;

function drawMenu(c: CanvasRenderingContext2D, layout: MenuLayout) {
  if (!canvas) return;

  const prevHoverIndex = activeHoverIndex;
  const currentHoverIndex = buttonIndexAt(layout, pointer.x, pointer.y);

  layout.buttons.forEach((btn) => {
    const isHovered = (currentHoverIndex === btn.index);
    const isClicked = (clickedItemIndex === btn.index);

    c.save();
    c.shadowBlur = 0;
    c.shadowColor = 'transparent';
    c.beginPath();
    if (c.roundRect) {
      c.roundRect(btn.x, btn.y, btn.width, btn.height, 10);
    } else {
      c.rect(btn.x, btn.y, btn.width, btn.height);
    }

    // A press once flipped the fill to its own gradient, whose stops at 0.48 and
    // 0.52 put a hard cyan/pink seam across the middle of the button — and it is
    // held for the whole 550ms slide-out, so that seam was the last thing seen of
    // the menu. The highlight gradient spreads the same palette over 0.25-0.70,
    // so press and highlight now share it.
    if (isHovered || isClicked) {
      const activeGrad = c.createLinearGradient(btn.x, btn.y, btn.x + btn.width, btn.y + btn.height);
      activeGrad.addColorStop(0.00, rgba(MENU_CYAN, 0.45));
      activeGrad.addColorStop(0.25, 'rgba(0, 180, 240, 0.55)');
      activeGrad.addColorStop(0.70, 'rgba(190, 0, 140, 0.62)');
      activeGrad.addColorStop(1.00, rgba(MENU_PINK_DEEP, 0.52));
      c.fillStyle = activeGrad;

      c.shadowColor = rgba(MENU_PINK_DEEP, 0.85);
      c.shadowBlur = 14;
      c.fill();

      const borderGrad = c.createLinearGradient(btn.x, btn.y, btn.x + btn.width, btn.y);
      borderGrad.addColorStop(0.00, hex(MENU_CYAN));
      borderGrad.addColorStop(0.45, '#00e1ff');
      borderGrad.addColorStop(0.55, hex(PINK));
      borderGrad.addColorStop(1.00, hex(MENU_PINK_DEEP));
      c.strokeStyle = borderGrad;
      c.lineWidth = 2.4;
      c.shadowColor = rgba(MENU_CYAN, 0.95);
      c.shadowBlur = 10;
      c.stroke();

      c.beginPath();
      c.moveTo(btn.x + 18, btn.y + 1.5);
      c.lineTo(btn.x + btn.width - 18, btn.y + 1.5);
      const sheenGrad = c.createLinearGradient(btn.x, 0, btn.x + btn.width, 0);
      sheenGrad.addColorStop(0.0, rgba(MENU_CYAN, 0.9));
      sheenGrad.addColorStop(0.5, rgba(WHITE, 0.95));
      sheenGrad.addColorStop(1.0, rgba(MENU_PINK_DEEP, 0.9));
      c.strokeStyle = sheenGrad;
      c.lineWidth = 1.6;
      c.stroke();
      c.shadowBlur = 0;
    } else {
      // Kept dark enough for the label to hold contrast over a bright ball
      // drifting behind it, but light enough that the drifting balls read
      // through the button instead of stopping at its edge.
      const idleGrad = c.createLinearGradient(btn.x, btn.y, btn.x, btn.y + btn.height);
      idleGrad.addColorStop(0.0, 'rgba(22, 10, 42, 0.40)');
      idleGrad.addColorStop(1.0, 'rgba(9, 4, 18, 0.52)');
      c.fillStyle = idleGrad;

      const idleBorderGrad = c.createLinearGradient(btn.x, 0, btn.x + btn.width, 0);
      idleBorderGrad.addColorStop(0.0, rgba(MENU_CYAN, 0.35));
      idleBorderGrad.addColorStop(1.0, rgba(MENU_PINK_DEEP, 0.35));
      c.strokeStyle = idleBorderGrad;
      c.lineWidth = 1.2;
      c.shadowColor = rgba(BLACK, 0.6);
      c.shadowBlur = 6;
      c.fill();
      c.stroke();
      c.shadowBlur = 0;
    }

    c.font = uiFont(800, btn.fontSize);
    c.textAlign = 'center';
    c.textBaseline = 'middle';

    if (isHovered || isClicked) {
      c.fillStyle = WHITE_HEX;
      c.shadowColor = hex(MENU_CYAN);
      c.shadowBlur = 10;
      c.fillText(btn.text, width / 2, btn.y + btn.height / 2);
      c.shadowBlur = 0;
    } else {
      c.fillStyle = '#f0e6ff';
      c.shadowColor = rgba(MENU_CYAN, 0.25);
      c.shadowBlur = 4;
      c.fillText(btn.text, width / 2, btn.y + btn.height / 2);
      c.shadowBlur = 0;
    }

    c.restore();
  });

  // Only a mouse sounds as the highlight moves. A finger sliding down the list
  // would otherwise fire a blip per button crossed, turning one considered tap
  // into a rattle — and the finger has not chosen anything yet.
  if (pointer.isMouse && currentHoverIndex !== -1 && currentHoverIndex !== prevHoverIndex) {
    const now = performance.now();
    if (now - lastSelectAt() > HOVER_QUIET_MS && now - lastInteractionTimestamp > HOVER_QUIET_MS) {
      const normX = width > 0 ? (pointer.x / width) * 2 - 1 : 0;
      playHoverClick(HOVER_BASE_HZ + currentHoverIndex * HOVER_STEP_HZ, normX);
    }
  }
  activeHoverIndex = currentHoverIndex;

  canvas.style.cursor = (activeHoverIndex !== -1) ? 'pointer' : 'default';
}

// ── Canvas sizing ──────────────────────────────────────────────────────

function resize() {
  if (!applyCanvasSize()) return;
  initAmbience(width, height);
}

/**
 * Re-apply the canvas size and DPR transform after Chrome restores a lost 2D
 * context (see recoverGraphics in main.ts). The size is unchanged, so this must
 * not go through resize(), which would also respawn the menu balls.
 */
function recoverCanvas() {
  clearSpriteCache();
  applyCanvasSize();
}

function applyCanvasSize(): boolean {
  if (!canvas || !ctx) return false;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const newW = window.innerWidth;
  const newH = window.innerHeight;
  const targetCanvasW = Math.floor(newW * dpr);
  const targetCanvasH = Math.floor(newH * dpr);

  width = newW;
  height = newH;

  if (canvas.width !== targetCanvasW || canvas.height !== targetCanvasH) {
    canvas.width = targetCanvasW;
    canvas.height = targetCanvasH;
  }

  if (ctx.resetTransform) ctx.resetTransform();
  else ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  return true;
}

// ── Input ──────────────────────────────────────────────────────────────

function getCanvasPointer(e: { clientX: number; clientY: number }): { x: number; y: number } {
  if (!canvas) return { x: -1000, y: -1000 };
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? width / rect.width : 1;
  const scaleY = rect.height > 0 ? height / rect.height : 1;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function handleInteraction(px?: number, py?: number) {
  const nowMs = performance.now();
  if (nowMs - lastInteractionTimestamp < INTERACTION_DEBOUNCE_MS) return;

  let targetIndex = activeHoverIndex;
  if (px !== undefined && py !== undefined) {
    targetIndex = buttonIndexAt(computeMenuLayout(width, height, ctx), px, py);
  }
  if (targetIndex === -1) return;

  lastInteractionTimestamp = nowMs;
  clickedItemIndex = targetIndex;
  const normX = width > 0 ? (px !== undefined ? (px / width) * 2 - 1 : 0) : 0;
  playBinauralClick(clickHz('select'), 0.16, normX, 'select');

  const selectedItem = menuItems[targetIndex];
  if (!selectedItem) return;

  const MODE_OF: Record<string, PlayMode> = { solo: 'solo', one_player: 'ai', two_player: 'duel' };
  const mode = MODE_OF[selectedItem.action];
  if (mode) {
    setTimeout(() => triggerSelection(mode), PRESS_HOLD_MS);
  } else if (selectedItem.action === 'options') {
    setTimeout(() => {
      clickedItemIndex = -1;
      if (onOptionsCallback) onOptionsCallback();
    }, PRESS_HOLD_MS);
  }
}

// ── Showing and hiding ─────────────────────────────────────────────────

function container(): HTMLElement | null {
  if (!menuContainer) menuContainer = document.getElementById('menu-screen');
  return menuContainer;
}

function triggerSelection(mode: PlayMode) {
  if (isTransitioning) return;
  isTransitioning = true;

  if (onModeSelectCallback) {
    onModeSelectCallback(mode);
  }

  const el = container();
  if (el && typeof window !== 'undefined') {
    el.classList.add('slide-out');
    setTimeout(() => {
      hideMenuImmediate();
      el.classList.remove('slide-out');
      isTransitioning = false;
    }, SLIDE_MS);
  } else {
    hideMenuImmediate();
    isTransitioning = false;
  }
}

function hideMenuImmediate() {
  clickedItemIndex = -1;
  setHidden(container(), true);
  menuActive = false;
  if (animationId) {
    safeCancelAnimationFrame(animationId);
    animationId = 0;
  }
}

export function slideOutRight(onComplete?: () => void) {
  const el = container();
  if (el && typeof window !== 'undefined') {
    el.classList.add('slide-out-right');
    setTimeout(() => {
      if (onComplete) onComplete();
    }, SLIDE_MS);
  } else if (onComplete) {
    onComplete();
  }
}

export function slideInFromRight() {
  const el = container();
  if (el && typeof window !== 'undefined') {
    el.classList.remove('slide-out-right');
  }
}

export function showMenu() {
  const el = container();
  if (el) {
    if (typeof window !== 'undefined') {
      el.classList.remove('slide-out', 'slide-out-right');
      el.classList.add('slide-in-start');
      setHidden(el, false);
      void el.offsetWidth;
      el.classList.remove('slide-in-start');
    } else {
      setHidden(el, false);
    }
  }
  menuActive = true;
  // The in-game bar toggles the same AudioStore flag, so the label may have gone
  // stale while the menu was down.
  updateAudioBtnLabel();
  updateFsBtnLabel();
  resize();
  if (!animationId) {
    animationId = safeRequestAnimationFrame(renderLoop);
  }
}

export function hideMenu() {
  hideMenuImmediate();
}

export function isMenuVisible(): boolean {
  return menuActive;
}

/**
 * True while the menu is an opaque full-screen cover, so nothing drawn behind it
 * can be seen. Goes false as soon as a selection starts the slide-out, which is
 * when the game underneath becomes visible again and has to be live.
 */
export function isMenuOccluding(): boolean {
  return menuActive && !isTransitioning;
}

// ── The bar buttons ────────────────────────────────────────────────────

function fullscreenApi() {
  const docEl = typeof document !== 'undefined' ? (document.documentElement as any) : null;
  return {
    docEl,
    // The Android and iOS apps are full screen already: no button there.
    request: docEl && !isNativeApp() ? (docEl.requestFullscreen || docEl.webkitRequestFullscreen || null) : null,
    exit: typeof document !== 'undefined' ? (document.exitFullscreen || (document as any).webkitExitFullscreen || null) : null,
    isOn: typeof document !== 'undefined' && !!(document.fullscreenElement || (document as any).webkitFullscreenElement),
  };
}

/** The speaker icon, with the "no" sign over it while the sound is off. Its name is in the markup. */
function updateAudioBtnLabel() {
  if (audioBtn) {
    audioBtn.classList.toggle('off', !AudioStore.soundOn);
    audioBtn.setAttribute('aria-pressed', String(AudioStore.soundOn));
  }
}

function updateFsBtnLabel() {
  if (!fsBtn) return;
  const fs = fullscreenApi();
  if (!fs.request) {
    setHidden(fsBtn, true);
    return;
  }
  // The icon stays the same; lit while the game is full screen.
  fsBtn.classList.toggle('active', fs.isOn);
  fsBtn.setAttribute('aria-pressed', String(fs.isOn));
}

// ── The frame loop ─────────────────────────────────────────────────────

function safeRequestAnimationFrame(cb: FrameRequestCallback): number {
  if (typeof requestAnimationFrame !== 'undefined') {
    return requestAnimationFrame(cb);
  }
  return setTimeout(cb, 16) as unknown as number;
}

function safeCancelAnimationFrame(id: number) {
  if (typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(id);
  } else {
    clearTimeout(id);
  }
}

function renderLoop() {
  if (!menuActive) return;
  if (isOptionsOpen()) {
    animationId = safeRequestAnimationFrame(renderLoop);
    return;
  }
  animFrame++;

  const c = ctx;
  if (c) {
    drawBackground(c, width, height, animFrame);
    drawMenuBalls(c, width, height);
    drawMenuFlashes(c, width, height);
    drawMenuPops(c, width, height);

    const layout = computeMenuLayout(width, height, c);
    drawLogo(c, layout, width, animFrame);
    drawMenu(c, layout);
  }

  animationId = safeRequestAnimationFrame(renderLoop);
}

export function initMenuScreen(onSelectMode: (mode: PlayMode) => void, onOptions?: () => void) {
  onModeSelectCallback = onSelectMode;
  onOptionsCallback = onOptions || null;
  menuContainer = document.getElementById('menu-screen');
  canvas = document.getElementById('gameMenu') as HTMLCanvasElement;
  audioBtn = document.getElementById('audioToggle') as HTMLButtonElement;
  fsBtn = document.getElementById('fsToggle') as HTMLButtonElement;
  onLanguageChange(() => { updateAudioBtnLabel(); updateFsBtnLabel(); clearMenuPops(); });

  if (!canvas) return;
  ctx = canvas.getContext('2d');

  resize();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', resize);
    canvas.addEventListener('contextrestored', recoverCanvas);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) recoverCanvas();
    });

    // Pointer events, one stream for mouse and finger — the same model
    // `ui/TouchControls.ts` aims the launchers with. The mouse and touch pair
    // these replace could both fire for one tap, because a browser follows a
    // touch with a synthesised mousedown, and the menu had only its 180ms
    // debounce standing between that and a second selection.
    // The icon row (help, records, language) is DOM over the canvas. Its buttons
    // act on click, but the menu acts on press and lift at the window, so a tap
    // on an icon that overlaps a drawn button — Options, in landscape — did both.
    const iconRow = document.querySelector?.('.menu-bottom-controls');
    for (const type of ['pointerdown', 'pointerup'] as const) iconRow?.addEventListener(type, e => e.stopPropagation());

    window.addEventListener('pointerdown', (e) => {
      if (!menuActive) return;
      const p = getCanvasPointer(e);
      pointer.x = p.x;
      pointer.y = p.y;
      pointer.isDown = true;
      pointer.isMouse = e.pointerType === 'mouse';
      // The gesture that unlocks the audio context. It has to be the press, not
      // the release, or the select sound the release plays is the one lost.
      initMenuAudio();
      if (pointer.isMouse) handleInteraction(p.x, p.y);
    });

    window.addEventListener('pointermove', (e) => {
      if (!menuActive) return;
      // A finger only moves the highlight while it is down. Without this, a
      // stylus or a phone reporting a hover would light buttons nobody is
      // touching.
      if (e.pointerType !== 'mouse' && !pointer.isDown) return;
      pointer.isMouse = e.pointerType === 'mouse';
      const p = getCanvasPointer(e);
      pointer.x = p.x;
      pointer.y = p.y;
    });

    window.addEventListener('pointerup', (e) => {
      const wasDown = pointer.isDown;
      pointer.isDown = false;
      if (!menuActive || e.pointerType === 'mouse') return;
      // The tap is the lift: whichever button the finger is over now is the one
      // chosen, and lifting off all of them chooses nothing — `handleInteraction`
      // returns on a point that hits no button, without a sound.
      const p = getCanvasPointer(e);
      pointer.x = p.x;
      pointer.y = p.y;
      if (wasDown) handleInteraction(p.x, p.y);
      parkPointer();
    });

    window.addEventListener('pointercancel', () => {
      pointer.isDown = false;
      parkPointer();
    });
  }

  audioBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    AudioStore.soundOn = !AudioStore.soundOn;
    updateAudioBtnLabel();
    // Without this the master gain and the ambient drone keep running when the
    // button says "Audio off" — soundOn alone only gates newly started voices.
    applyGain();
    if (AudioStore.soundOn) {
      playBinauralClick(587.33, 0.20, 0, 'toggle');
    }
  });

  if (fsBtn) {
    const fs = fullscreenApi();
    if (!fs.request) {
      setHidden(fsBtn, true);
    } else {
      fsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        try {
          if (fullscreenApi().isOn) {
            if (fs.exit) fs.exit.call(document);
          } else {
            fs.request.call(fs.docEl);
          }
        } catch (err) {}
        if (AudioStore.soundOn) {
          playBinauralClick(587.33, 0.20, 0, 'toggle');
        }
      });
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('fullscreenchange', () => {
      updateFsBtnLabel();
    });
    document.addEventListener('webkitfullscreenchange', () => {
      updateFsBtnLabel();
    });
  }

  updateAudioBtnLabel();
  updateFsBtnLabel();
}
