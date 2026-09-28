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
import { CORE_RULES } from './RulesText';
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
        case 'aim': return { line: 'Drag anywhere to aim.', sub: 'Farther means harder.' };
        case 'lock': return { line: 'Same colours stick.', sub: 'Lock one onto the pair.' };
        // Deep red, not red: a throw at the red threshold never booms the
        // group, measured on the real loop. See TEACH_STRENGTH in game/Tutorial.ts.
        case 'boom': return { line: 'A different colour, thrown hard, booms the whole group.', sub: 'Drag farther, until the arrow is deep red.' };
        case 'black': return { line: 'The black ball sticks to any colour.', sub: 'Lock it onto the pair.' };
        case 'white': return { line: 'The white ball booms whatever it touches.', sub: 'Even softly. Even the black.' };
      }
      return null;
    case 'touched':
      return { line: 'It fires by itself when the ring fills.', sub: 'Drag again to aim the next one.' };
    case 'firstLock':
      return { line: 'Keep building.', sub: 'Make it four.' };
    case 'tooHard':
      return { line: 'Gently — a soft throw sticks better.' };
    case 'peel':
      return { line: 'Too soft — that only knocked one loose.', sub: 'Pull farther.' };
    case 'again':
      return { line: 'Not quite.', sub: 'Drag to aim, and try again.' };
    case 'hint':
      return { line: 'Try it like this.', sub: 'Drag to where the circle stops.' };
    case 'stepDone':
      switch (event.step) {
        case 'aim': return { line: 'Nice.' };
        case 'lock': return { line: 'A group.' };
        // Quotes what this player's own boom and building paid, read from the
        // counters, so it stays true if the pay table changes.
        case 'boom': return { line: `That boom paid +${event.boomPts}.`, sub: `Building it paid +${event.lockPts}. Bigger pays more.` };
        case 'black': return { line: 'Black sticks to anything.', sub: 'Its locks pay double.' };
        case 'white': return { line: 'White booms anything.', sub: "It's the only way to clear black." };
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
    title: "You're ready",
    lines: [...CORE_RULES],
    small: matchLen > 0 ? `Most points in ${formatClock(matchLen)} wins.` : 'Most points wins.',
  };
}

/**
 * The one button at the end. A player who came here on their way into a mode
 * goes on into it; anyone else goes back to the menu they came from.
 */
export function closingButton(then: PlayMode | null): string {
  return then ? 'Start game' : 'Back to menu';
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

