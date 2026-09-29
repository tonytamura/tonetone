/**
 * The first-play offer, and the help screen that replays the tutorial.
 *
 * The tutorial is offered once, at the moment of intent: the first time any
 * mode is chosen on a device that has neither finished nor skipped it. The menu
 * stays the first impression. After that it is never offered again, and the
 * help button on the main screen is how to see it once more.
 *
 * Design: the Tutorial: Design page in Notion, §4, as amended by the help
 * button decision (2026-09-19) and the offer decision (2026-09-27).
 */
import { PlayMode } from '../game/GameState';
import { renderSoundTester } from './SoundTester';
import { uiClick } from '../audio/UiSounds';
import { ruleRows } from './RulesText';
import { onLanguageChange } from '../i18n/I18n';
import { fillCredits } from './Credits';
import { RecordSection } from './Records';
import { setHidden } from './Dom';

/** Offer the tutorial exactly when it has not been seen, whichever mode was chosen. */
export function shouldOfferTutorial(seen: boolean, _mode: PlayMode): boolean {
  return !seen;
}

function el(id: string) {
  return document.getElementById(id);
}

export interface FirstPlayOffer {
  show(mode: PlayMode): void;
  isOpen(): boolean;
  /** Close it unanswered, as leaving for the menu does. It will be offered again. */
  dismiss(): void;
}

/** "New to Tone Boom? Show me / Skip", over the field of the mode just chosen. */
export function createFirstPlayOffer(handlers: {
  showMe: (mode: PlayMode) => void;
  skip: (mode: PlayMode) => void;
}): FirstPlayOffer {
  let pending: PlayMode | null = null;

  function answer(fn: (mode: PlayMode) => void) {
    if (!pending) return;
    const mode = pending;
    pending = null;
    setHidden(el('offer-overlay'), true);
    fn(mode);
  }

  el('offer-show')?.addEventListener('click', e => { e.stopPropagation(); uiClick('confirm'); answer(handlers.showMe); });
  el('offer-skip')?.addEventListener('click', e => { e.stopPropagation(); uiClick('cancel'); answer(handlers.skip); });

  return {
    show(mode) {
      pending = mode;
      setHidden(el('offer-overlay'), false);
    },
    isOpen: () => pending !== null,
    dismiss() {
      pending = null;
      setHidden(el('offer-overlay'), true);
    },
  };
}

/**
 * The help screen over the main menu: replay the tutorial, the records, the
 * rules card, the credits, and last the sound preview.
 * Replaying never resets the "seen" flag; it only shows the lesson again.
 */
export function setupHelpScreen(onReplay: () => void, recordsContent: () => RecordSection[] = () => []) {
  // The rules and credits are written into the page, so they are written again
  // in the new words whenever the language changes.
  const fillText = () => {
    const rules = el('help-rules');
    if (rules) {
      rules.innerHTML = '';
      for (const r of ruleRows()) {
        const dt = document.createElement('dt');
        dt.textContent = r.label;
        const dd = document.createElement('dd');
        dd.textContent = r.text;
        rules.append(dt, dd);
      }
    }
    fillCredits(el('help-credits'));
  };
  fillText();
  onLanguageChange(fillText);
  // One card at a time: How to play, or one of the cards it opens.
  const showCard = (which: 'help' | 'records' | 'sounds') => {
    setHidden(document.querySelector('#help-overlay > .help-card:not(#records-card):not(#sounds-card)') as HTMLElement | null, which !== 'help');
    setHidden(el('records-card'), which !== 'records');
    setHidden(el('sounds-card'), which !== 'sounds');
  };
  const close = () => { setHidden(el('help-overlay'), true); showCard('help'); };
  el('help-records')?.addEventListener('click', e => {
    e.stopPropagation();
    uiClick('confirm');
    fillRecords(el('records-body'), recordsContent());
    showCard('records');
  });
  el('records-back')?.addEventListener('click', e => { e.stopPropagation(); uiClick('cancel'); showCard('help'); });
  el('help-sounds')?.addEventListener('click', e => {
    e.stopPropagation();
    uiClick('confirm');
    // Built fresh on each visit, so every readout shows the settings as they are now.
    const box = el('sound-tester-container');
    if (box) renderSoundTester(box);
    showCard('sounds');
  });
  el('sounds-back')?.addEventListener('click', e => { e.stopPropagation(); uiClick('cancel'); showCard('help'); });
  el('helpBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    uiClick('confirm');
    setHidden(el('help-overlay'), false);
  });
  el('help-close')?.addEventListener('click', e => { e.stopPropagation(); uiClick('cancel'); close(); });
  el('help-replay')?.addEventListener('click', e => {
    e.stopPropagation();
    uiClick('confirm');
    close();
    onReplay();
  });
  // The menu listens on the window for its own taps; nothing on this screen
  // should reach it and choose a mode underneath.
  for (const type of ['pointerdown', 'pointerup'] as const) {
    el('help-overlay')?.addEventListener(type, e => e.stopPropagation());
  }
}

/**
 * Fill the Records card from `recordSections`. Read fresh each time it opens.
 * Each row is a grid of the label and its values, in fixed-width columns so
 * the numbers line up under their heads.
 */
function fillRecords(root: HTMLElement | null, sections: RecordSection[]) {
  if (!root) return;
  root.innerHTML = '';
  const row = (cls: string, label: string, values: string[], cols: number, note?: string) => {
    const r = document.createElement('div');
    r.className = cls;
    r.style.setProperty('--cols', String(cols));
    const l = document.createElement('span');
    l.textContent = label;
    if (note) {
      const n = document.createElement('small');
      n.className = 'records-note';
      n.textContent = note;
      l.appendChild(n);
    }
    r.appendChild(l);
    for (const v of values) {
      const b = document.createElement(cls === 'records-row' ? 'b' : 'span');
      b.textContent = v;
      r.appendChild(b);
    }
    root.appendChild(r);
  };
  for (const sec of sections) {
    const title = document.createElement('div');
    title.className = 'records-section-title';
    title.textContent = sec.title;
    root.appendChild(title);
    const cols = sec.columns?.length ?? 1;
    if (!sec.rows.length) {
      const e = document.createElement('div');
      e.className = 'records-empty';
      e.textContent = sec.empty ?? '';
      root.appendChild(e);
      continue;
    }
    if (sec.columns) row('records-row records-head', '', sec.columns, cols);
    for (const r of sec.rows) row('records-row', r.label, r.values, cols, r.note);
  }
}
