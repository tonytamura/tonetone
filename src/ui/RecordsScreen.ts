/**
 * The Records screen, opened by the trophy on the main menu: the best solo
 * score on every mode, two-player wins by mode, and each AI's best score and
 * wins. Built fresh from storage each time it opens, with a celebration
 * around it (`RecordsCelebration.ts`) for as long as it stays open.
 */
import { RecordSection } from './Records';
import { startRecordsCelebration } from './RecordsCelebration';
import { setHidden } from './Dom';
import { uiClick } from '../audio/UiSounds';

function el(id: string) {
  return document.getElementById(id);
}

/**
 * `content` builds the card; `words` the celebration's floating words, from the
 * same records (see `recordWords`).
 */
export function setupRecordsScreen(content: () => RecordSection[], words: () => string[] = () => []) {
  const overlay = el('records-overlay');
  let stopCelebration: (() => void) | null = null;
  el('recordsBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    uiClick('confirm');
    fillRecords(el('records-body'), content());
    const card = el('records-card');
    if (card) card.scrollTop = 0;
    setHidden(overlay, false);
    const canvas = el('records-canvas') as HTMLCanvasElement | null;
    stopCelebration?.();
    stopCelebration = canvas ? startRecordsCelebration(canvas, card, words()) : null;
  });
  el('records-close')?.addEventListener('click', e => {
    e.stopPropagation();
    uiClick('cancel');
    stopCelebration?.();
    stopCelebration = null;
    setHidden(overlay, true);
  });
  // The menu listens on the window for its own taps; nothing on this screen
  // should reach it and choose a mode underneath.
  for (const type of ['pointerdown', 'pointerup'] as const) {
    overlay?.addEventListener(type, e => e.stopPropagation());
  }
}

/**
 * Fill the Records card from `recordSections`. Read fresh each time it opens.
 * Each row is a grid of the label and its values, in fixed-width columns so
 * the numbers line up under their heads.
 */
export function fillRecords(root: HTMLElement | null, sections: RecordSection[]) {
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
