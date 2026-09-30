/**
 * The seat card: what a two-player match shows before its countdown.
 *
 * The tutorial is single-seat and offered once per device, so in a two-player
 * match the second player has usually never seen it — and would be reading its
 * banner upside down if they had. So every two-player match started from the
 * menu opens with one card per half, each facing its own player: this half is
 * yours, drag in it to aim, lay the device flat, and the five rules. Each player
 * taps their half when ready, and the existing countdown starts once both have.
 *
 * Design: the seat card sections of the Tutorial: Design page in Notion, and the
 * decision on its task (2026-09-28) that it carries the rules too.
 */
import { PlayMode } from '../game/GameState';
import { coreRules } from './RulesText';
import { t } from '../i18n/I18n';
import { setHidden } from './Dom';

/** Only two people at one device need to be told which half is theirs. */
export function needsSeatCard(mode: PlayMode): boolean {
  return mode === 'duel';
}

/** Which halves are ready: index 0 is the bottom player, 1 the top. */
export interface SeatState {
  ready: [boolean, boolean];
}

export function newSeatState(): SeatState {
  return { ready: [false, false] };
}

/**
 * A tap on a half marks that half ready, whoever made it, so one person can
 * start both. The card teaches; it does not check.
 */
export function tapHalf(state: SeatState, half: 0 | 1): SeatState {
  const ready: [boolean, boolean] = [state.ready[0], state.ready[1]];
  ready[half] = true;
  return { ready };
}

export function bothReady(state: SeatState): boolean {
  return state.ready[0] && state.ready[1];
}

/** The words on each half. */
export function seatCopy() {
  return {
    title: t('seat.title'),
    lines: [t('seat.aim'), t('seat.flat')],
    rules: coreRules(),
    tap: t('seat.tap'),
    ready: t('seat.ready'),
  };
}

export interface SeatCard {
  show(): void;
  isActive(): boolean;
  /** Take it down without starting the match, as leaving for the menu does. */
  dismiss(): void;
}

function el(id: string) {
  return document.getElementById(id);
}

/**
 * Build the card's two halves from `seatCopy` and wire their taps. `onReady` runs
 * once, when the second half is tapped.
 */
export function createSeatCard(onReady: () => void): SeatCard {
  let state: SeatState | null = null;
  // Read afresh on every show: the card is built at start-up, before a language
  // other than English has loaded, so copy taken then stayed English.
  let copy = seatCopy();

  function fill(half: HTMLElement) {
    half.innerHTML = '';
    const add = (cls: string, text: string) => {
      const d = document.createElement('div');
      d.className = cls;
      d.textContent = text;
      half.appendChild(d);
      return d;
    };
    add('seat-title', copy.title);
    for (const l of copy.lines) add('seat-line', l);
    const rules = document.createElement('div');
    rules.className = 'seat-rules';
    for (const r of copy.rules) {
      const d = document.createElement('div');
      d.textContent = r;
      rules.appendChild(d);
    }
    half.appendChild(rules);
    add('seat-tap', copy.tap);
  }

  function render() {
    for (const [id, half] of [['seat-bottom', 0], ['seat-top', 1]] as const) {
      const h = el(id);
      if (!h || !state) continue;
      const ready = state.ready[half];
      h.classList.toggle('ready', ready);
      const tap = h.querySelector('.seat-tap');
      if (tap) tap.textContent = ready ? copy.ready : copy.tap;
    }
  }

  for (const [id, half] of [['seat-bottom', 0], ['seat-top', 1]] as const) {
    el(id)?.addEventListener('click', e => {
      e.stopPropagation();
      if (!state) return;
      state = tapHalf(state, half);
      render();
      if (bothReady(state)) {
        state = null;
        setHidden(el('seat-card'), true);
        onReady();
      }
    });
  }

  return {
    show() {
      copy = seatCopy();
      state = newSeatState();
      for (const id of ['seat-bottom', 'seat-top']) {
        const h = el(id);
        if (h) fill(h);
      }
      render();
      setHidden(el('seat-card'), false);
    },
    isActive: () => state !== null,
    dismiss() {
      state = null;
      setHidden(el('seat-card'), true);
    },
  };
}
