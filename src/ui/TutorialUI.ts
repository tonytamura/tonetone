/**
 * The tutorial on screen: the banner, the closing card, and the glue that runs
 * the controller in `game/Tutorial.ts` beside the page's frame loop.
 *
 * The words live in `tutorialLine` and `closingCard`, which touch no DOM, so
 * `tests/ui/TutorialUI.test.ts` can hold the copy to the design without a
 * browser. Design: the Tutorial: Design page in Notion, §3.
 */
import { Game, PlayMode } from '../game/GameState';
import { formatClock } from '../game/Clock';
import { Ball } from '../physics/Types';
import {
  Tutorial, TutorialEvent, TUTORIAL_STEPS,
  drainTutorialEvents, endTutorial, noteTouch, startTutorial, targetGroupOf, tutorialAfterFrame, tutorialBeforeFrame,
  tutorialHint,
} from '../game/Tutorial';
import { uiClick } from '../audio/UiSounds';
import { coreRules } from './RulesText';
import { t } from '../i18n/I18n';
import { setHidden } from './Dom';

/** The clock has nothing to count in the tutorial, and says so. */
export const TUTORIAL_CLOCK = '—:—';

export interface BannerLine {
  line: string;
  sub?: string;
}

/**
 * What the banner says after `event`, or null to leave it as it is.
 *
 * One instruction at a time, never more than two short lines on a 360px phone.
 * Colours are never named: the ring on the field points instead, since colour
 * names fail for colour-blind players. Black and white are the two balls with
 * names of their own, and they differ in brightness rather than hue.
 */
export function tutorialLine(event: TutorialEvent): BannerLine | null {
  switch (event.type) {
    case 'step':
      switch (event.step) {
        case 'aim': return { line: t('tut.aim.line'), sub: t('tut.aim.sub') };
        case 'lock': return { line: t('tut.lock.line'), sub: t('tut.lock.sub') };
        // Deep red, not red: a throw at the red threshold never booms the
        // group, measured on the real loop. See TEACH_STRENGTH in game/Tutorial.ts.
        case 'boom': return { line: t('tut.boom.line'), sub: t('tut.boom.sub') };
        case 'black': return { line: t('tut.black.line'), sub: t('tut.black.sub') };
        case 'white': return { line: t('tut.white.line'), sub: t('tut.white.sub') };
      }
      return null;
    case 'touched':
      return { line: t('tut.touched.line'), sub: t('tut.touched.sub') };
    case 'firstLock':
      return { line: t('tut.firstLock.line'), sub: t('tut.firstLock.sub') };
    case 'tooHard':
      return { line: t('tut.tooHard.line') };
    case 'peel':
      return { line: t('tut.peel.line'), sub: t('tut.peel.sub') };
    case 'again':
      return { line: t('tut.again.line'), sub: t('tut.again.sub') };
    case 'hint':
      return { line: t('tut.hint.line'), sub: t('tut.hint.sub') };
    case 'stepDone':
      switch (event.step) {
        case 'aim': return { line: t('tut.done.aim') };
        case 'lock': return { line: t('tut.done.lock') };
        // Quotes what this player's own boom and building paid, read from the
        // counters, so it stays true if the pay table changes.
        case 'boom': return { line: t('tut.done.boom.line', { boom: event.boomPts }), sub: t('tut.done.boom.sub', { lock: event.lockPts }) };
        case 'black': return { line: t('tut.done.black.line'), sub: t('tut.done.black.sub') };
        case 'white': return { line: t('tut.done.white.line'), sub: t('tut.done.white.sub') };
      }
      return null;
    default:
      return null;
  }
}

export interface CardCopy {
  title: string;
  lines: string[];
  small?: string;
}

/** The last card: the rules again, and how a match is won. */
export function closingCard(matchLen: number): CardCopy {
  return {
    title: t('tut.card.title'),
    lines: coreRules(),
    small: matchLen > 0 ? t('tut.card.small', { time: formatClock(matchLen) }) : t('tut.card.smallEndless'),
  };
}

/**
 * The one button at the end. A player who came here on their way into a mode
 * goes on into it; anyone else goes back to the menu they came from.
 */
export function closingButton(then: PlayMode | null): string {
  return then ? t('tut.card.start') : t('tut.card.menu');
}

export interface TutorialSessionDeps {
  game: Game;
  canvas: HTMLCanvasElement;
  size: () => { W: number; H: number };
  /** Make the stage ready for a solo field before the board is laid out. */
  prepare: () => void;
  /** Start a real match in `mode`. */
  play: (mode: PlayMode) => void;
  /** Leave for the main menu. */
  toMenu: () => void;
  /** The player finished the tutorial or skipped it: it need not be offered again. */
  onDone: () => void;
}

export interface TutorialStartOptions {
  /** The mode the player was on their way into, if any; the end card starts it. */
  then?: PlayMode | null;
}

export interface TutorialSession {
  start(opts?: TutorialStartOptions): void;
  isActive(): boolean;
  /** Run before `advanceFrame`. */
  before(): void;
  /** Run after `advanceFrame`, with its `dt` and `threw`. */
  after(dt: number, threw: number): void;
  /** The balls the ring should circle this frame. */
  ringBalls(): Ball[];
  /** Where the hint's fingertip loops this frame, or null when there is no hint. */
  hint(): { from: { x: number; y: number }; to: { x: number; y: number } } | null;
  /** End it, put the settings back and clear the screen, without going anywhere. */
  stop(): void;
}

function el(id: string) {
  return document.getElementById(id);
}

export function createTutorialSession(deps: TutorialSessionDeps): TutorialSession {
  const { game } = deps;
  let tut: Tutorial | null = null;
  let then: PlayMode | null = null;
  let pressed = false;

  function setBanner(b: BannerLine) {
    const line = el('tut-line'), sub = el('tut-sub');
    if (line) line.textContent = b.line;
    if (sub) { sub.textContent = b.sub || ''; setHidden(sub, !b.sub); }
  }

  /** One dot per step, built from the step list so the two cannot disagree. */
  function buildDots() {
    const dots = el('tut-dots');
    if (!dots) return;
    dots.innerHTML = '';
    for (let i = 0; i < TUTORIAL_STEPS.length; i++) dots.appendChild(document.createElement('i'));
  }

  function setDots(at: number) {
    const dots = el('tut-dots');
    if (!dots) return;
    Array.from(dots.children).forEach((d, i) => {
      d.classList.toggle('done', i < at);
      d.classList.toggle('now', i === at);
    });
  }

  function showClosing() {
    uiClick('confirm');
    // The saved match length, not the tutorial's: the card is about the match
    // they are about to play.
    const len = tut ? tut.saved.matchLen : game.matchLen;
    const copy = closingCard(len);
    const title = el('tut-card-title'), body = el('tut-card-body'), small = el('tut-card-small'), actions = el('tut-card-actions');
    if (title) title.textContent = copy.title;
    if (body) {
      body.innerHTML = '';
      for (const l of copy.lines) {
        const p = document.createElement('div');
        p.textContent = l;
        body.appendChild(p);
      }
    }
    if (small) { small.textContent = copy.small || ''; setHidden(small, !copy.small); }
    if (actions) {
      actions.innerHTML = '';
      const btn = document.createElement('button');
      btn.className = 'confirm-btn primary tut-primary';
      btn.textContent = closingButton(then);
      const goTo = then;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        stop();
        if (goTo) deps.play(goTo);
        else { uiClick('cancel'); deps.toMenu(); }
      });
      actions.appendChild(btn);
    }
    setHidden(el('tut-banner'), true);
    setHidden(el('tut-card-overlay'), false);
  }

  function handle(e: TutorialEvent) {
    if (e.type === 'step') setDots(TUTORIAL_STEPS.indexOf(e.step));
    if (e.type === 'stepDone') setDots(TUTORIAL_STEPS.indexOf(e.step) + 1);
    if (e.type === 'finished') { deps.onDone(); showClosing(); return; }
    const b = tutorialLine(e);
    if (b) setBanner(b);
  }

  function stop() {
    if (!tut) return;
    endTutorial(tut, game);
    tut = null;
    pressed = false;
    setHidden(el('tut-banner'), true);
    setHidden(el('tut-card-overlay'), true);
  }

  // A press, or a drag while pressed, is the player acting: it lets the next
  // throw fly. A mouse moving over the field without a button down is not.
  const act = () => { if (tut && !game.paused) noteTouch(tut); };
  deps.canvas.addEventListener('pointerdown', () => { pressed = true; act(); });
  deps.canvas.addEventListener('pointermove', () => { if (pressed) act(); });
  const release = () => { pressed = false; };
  deps.canvas.addEventListener('pointerup', release);
  deps.canvas.addEventListener('pointercancel', release);

  el('tut-skip')?.addEventListener('click', e => {
    e.stopPropagation();
    uiClick('cancel');
    deps.onDone();
    const goTo = then;
    stop();
    // Skipping is not refusing to play: someone on their way into a mode goes on.
    if (goTo) deps.play(goTo);
    else deps.toMenu();
  });

  return {
    start(opts = {}) {
      if (tut) stop();
      then = opts.then ?? null;
      deps.prepare();
      const { W, H } = deps.size();
      tut = startTutorial(game, W, H);
      buildDots();
      setHidden(el('tut-card-overlay'), true);
      setHidden(el('tut-banner'), false);
      for (const e of drainTutorialEvents(tut)) handle(e);
    },
    isActive: () => tut !== null,
    before() {
      if (tut) tutorialBeforeFrame(tut, game);
    },
    after(dt, threw) {
      if (!tut) return;
      const { W, H } = deps.size();
      // What the banner really covers, so a group stopped under it is moved
      // out. Read each frame: the banner reflows when its line changes.
      const banner = el('tut-banner');
      if (banner && !banner.hidden) {
        const bottom = banner.getBoundingClientRect().bottom - deps.canvas.getBoundingClientRect().top;
        if (bottom > 0) tut.topInset = bottom;
      }
      tutorialAfterFrame(tut, game, W, H, dt, threw);
      for (const e of drainTutorialEvents(tut)) handle(e);
    },
    ringBalls() {
      if (!tut || tut.step === 'done') return [];
      // The whole group the target belongs to, so the ring grows with what the
      // player builds rather than staying on the pair it began as.
      const g = targetGroupOf(tut, game);
      return g ? g.members.filter(m => !m.ghost) : [];
    },
    hint() {
      if (!tut) return null;
      const { W, H } = deps.size();
      return tutorialHint(tut, game, W, H);
    },
    stop,
  };
}

