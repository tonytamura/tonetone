/**
 * The tutorial on screen: the banner, the cards, and the glue that runs the
 * controller in `game/Tutorial.ts` beside the page's frame loop.
 *
 * The words live in `tutorialLine` and the card builders below, which touch no
 * DOM, so `tests/ui/TutorialUI.test.ts` can hold the copy to the design without
 * a browser. Design: the Tutorial: Design page in Notion, §3.
 */
import { Game, PlayMode } from '../game/GameState';
import { formatClock } from '../game/Clock';
import { Ball } from '../physics/Types';
import {
  Tutorial, TutorialEvent, TutorialStep, TUTORIAL_STEPS,
  drainTutorialEvents, endTutorial, noteTouch, startTutorial, tutorialAfterFrame, tutorialBeforeFrame,
} from '../game/Tutorial';
import { uiClick } from '../audio/UiSounds';
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
 * names fail for colour-blind players.
 */
export function tutorialLine(event: TutorialEvent): BannerLine | null {
  switch (event.type) {
    case 'step':
      if (event.step === 'aim') return { line: 'Drag anywhere to aim.', sub: 'Farther means harder.' };
      if (event.step === 'lock') return { line: 'Same colours stick.', sub: 'Lock one onto the pair.' };
      // Deep red, not red: a throw at the red threshold never booms the group,
      // measured on the real loop. See TEACH_STRENGTH in game/Tutorial.ts.
      return { line: 'A different colour, thrown hard, booms the whole group.', sub: 'Drag farther, until the arrow is deep red.' };
    case 'touched':
      return { line: 'It fires by itself when the ring fills.', sub: 'Hit the ball.' };
    case 'firstLock':
      return { line: 'Keep building.', sub: 'Make it four.' };
    case 'tooHard':
      return { line: 'Gently — a soft throw sticks better.' };
    case 'peel':
      return { line: 'Too soft — that only knocked one loose.', sub: 'Pull farther.' };
    case 'stepDone':
      if (event.step === 'aim') return { line: 'Nice.' };
      if (event.step === 'lock') return { line: 'A group.' };
      return { line: 'Boom.' };
    default:
      return null;
  }
}

export interface CardCopy {
  title: string;
  lines: string[];
  small?: string;
}

/**
 * The card after the boom. It quotes what this player's own boom and building
 * paid, read from the counters, so it stays true if the pay table changes.
 */
export function successCard(lockPts: number, boomPts: number): CardCopy {
  return {
    title: 'Boom',
    lines: [`That boom paid +${boomPts}.`, `Building the group paid +${lockPts}.`, 'Bigger groups pay much more.'],
    small: 'The pieces fly off, and can boom other groups.',
  };
}

/** The last card: the three rules again, and how a match is won. */
export function closingCard(matchLen: number): CardCopy {
  return {
    title: "You're ready",
    lines: ['Aim — it fires by itself.', 'Same colours lock.', 'A different colour, thrown hard, booms.'],
    small: matchLen > 0 ? `Most points in ${formatClock(matchLen)} wins.` : 'Most points wins.',
  };
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
}

export interface TutorialSession {
  start(): void;
  isActive(): boolean;
  /** Run before `advanceFrame`. */
  before(): void;
  /** Run after `advanceFrame`, with its `dt` and `threw`. */
  after(dt: number, threw: number): void;
  /** The balls the ring should circle this frame. */
  ringBalls(): Ball[];
  /** End it, put the settings back and clear the screen, without going anywhere. */
  stop(): void;
}

function el(id: string) {
  return document.getElementById(id);
}

export function createTutorialSession(deps: TutorialSessionDeps): TutorialSession {
  const { game } = deps;
  let tut: Tutorial | null = null;
  let boomPaid = { lockPts: 0, boomPts: 0 };

  function setBanner(b: BannerLine) {
    const line = el('tut-line'), sub = el('tut-sub');
    if (line) line.textContent = b.line;
    if (sub) { sub.textContent = b.sub || ''; setHidden(sub, !b.sub); }
  }

  function setDots(step: TutorialStep | 'done') {
    const dots = el('tut-dots');
    if (!dots) return;
    const at = step === 'done' ? TUTORIAL_STEPS.length : TUTORIAL_STEPS.indexOf(step);
    Array.from(dots.children).forEach((d, i) => {
      d.classList.toggle('done', i < at);
      d.classList.toggle('now', i === at);
    });
  }

  function showCard(copy: CardCopy, buttons: { label: string; primary?: boolean; act: () => void }[]) {
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
      for (const b of buttons) {
        const btn = document.createElement('button');
        btn.className = 'confirm-btn ' + (b.primary ? 'primary tut-primary' : 'secondary');
        btn.textContent = b.label;
        btn.addEventListener('click', e => { e.stopPropagation(); b.act(); });
        actions.appendChild(btn);
      }
    }
    setHidden(el('tut-banner'), true);
    setHidden(el('tut-card-overlay'), false);
  }

  function showClosing() {
    uiClick('confirm');
    // The saved match length, not the tutorial's: the card is about the match
    // they are about to play.
    const len = tut ? tut.saved.matchLen : game.matchLen;
    showCard(closingCard(len), [
      { label: 'Play solo', primary: true, act: () => { stop(); deps.play('solo'); } },
      { label: 'Play vs AI', act: () => { stop(); deps.play('ai'); } },
      { label: 'Menu', act: () => { uiClick('cancel'); stop(); deps.toMenu(); } },
    ]);
  }

  function handle(e: TutorialEvent) {
    if (e.type === 'step') setDots(e.step);
    if (e.type === 'stepDone') {
      setDots(e.step === 'aim' ? 'lock' : e.step === 'lock' ? 'boom' : 'done');
      if (e.step === 'boom') boomPaid = { lockPts: e.lockPts, boomPts: e.boomPts };
    }
    if (e.type === 'finished') {
      showCard(successCard(boomPaid.lockPts, boomPaid.boomPts), [
        { label: 'Next', primary: true, act: showClosing },
      ]);
      return;
    }
    const b = tutorialLine(e);
    if (b) setBanner(b);
  }

  function stop() {
    if (!tut) return;
    endTutorial(tut, game);
    tut = null;
    setHidden(el('tut-banner'), true);
    setHidden(el('tut-card-overlay'), true);
  }

  deps.canvas.addEventListener('pointerdown', () => {
    if (tut && !game.paused) noteTouch(tut);
  });
  el('tut-skip')?.addEventListener('click', e => {
    e.stopPropagation();
    uiClick('cancel');
    stop();
    deps.toMenu();
  });

  return {
    start() {
      if (tut) stop();
      deps.prepare();
      const { W, H } = deps.size();
      tut = startTutorial(game, W, H);
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
      tutorialAfterFrame(tut, game, W, H, dt, threw);
      for (const e of drainTutorialEvents(tut)) handle(e);
    },
    ringBalls() {
      if (!tut || tut.step === 'done') return [];
      // The whole group the target belongs to, so the ring grows with what the
      // player builds in step 2 rather than staying on the pair it began as.
      for (const id of tut.targetIds) {
        const b = game.byId.get(id);
        if (b && !b.ghost) return b.group.members.filter(m => !m.ghost);
      }
      return [];
    },
    stop,
  };
}
