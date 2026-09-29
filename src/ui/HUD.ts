import { Game } from '../game/GameState';
import { P_COLOR } from '../graphics/Renderer';
import { initAudio, fadeDroneForResults } from '../audio/SynthEngine';
import { formatClock } from '../game/Clock';
import { setHidden } from './Dom';
import { ResultNotes } from './Records';
import { AI_LEVELS, againstAgi } from '../game/AI';
import { t } from '../i18n/I18n';

/**
 * `updateHUD` runs inside the rAF callback on every frame, but almost nothing it
 * writes changes between frames: measured over a 60s match, 95.9% of its
 * innerHTML writes and 99.1% of its textContent writes set the value the element
 * already held — 38,699 redundant DOM writes a minute. Each redundant innerHTML
 * write still runs the HTML parser and invalidates style over the subtree, and
 * that main-thread time is what pushes frames past budget and starves the Web
 * Audio render thread, which is heard as crackle. So remember what was last
 * written to each element and only touch the DOM on a real change.
 *
 * The memo is keyed on the element itself, so a fresh element (a new page, or a
 * test rebuilding its mocks) starts with an empty memo and is always written.
 */
const lastWritten = new WeakMap<object, Record<string, string>>();

function write(node: any, field: 'innerHTML' | 'textContent', value: string) {
  if (!node) return;
  let memo = lastWritten.get(node);
  if (!memo) { memo = {}; lastWritten.set(node, memo); }
  if (memo[field] === value) return;
  memo[field] = value;
  node[field] = value;
}

/** Element lookups are cached per `document`, so swapping it out resets them. */
let cachedDoc: any = null;
const elCache = new Map<string, any>();

function el(id: string): any {
  if (cachedDoc !== document) { cachedDoc = document; elCache.clear(); }
  const hit = elCache.get(id);
  if (hit) return hit;
  const node = document.getElementById(id);
  if (node) elCache.set(id, node);
  return node;
}

export function updateHUD(game: Game, clockText?: string) {
  write(el('hudBig'), 'textContent', String(game.killBig));
  write(el('hudGroups'), 'textContent', String(game.killGroups));
  write(el('hudBalls'), 'textContent', String(game.killBalls));

  // Score display
  const p1Label = game.aiOn ? t('hud.you') : (game.twoPlayer ? 'P1' : t('hud.score'));
  // Against the AI, its rung's own name: AI1 … AI9, AGI.
  const p2Label = game.aiOn ? (AI_LEVELS[game.aiLevel]?.label ?? 'AI') : 'P2';

  const formatScore = (label: string, pts: number) =>
    `<span class="score-lbl">${label}</span><span class="score-num">${pts}</span>`;

  write(el('scoreP1'), 'innerHTML', formatScore(p1Label, game.players[0].score));
  write(el('scoreP1_2'), 'innerHTML', formatScore('P1', game.players[0].score));
  write(el('scoreP2_1'), 'innerHTML', formatScore(p2Label, game.players[1].score));
  write(el('scoreP2_2'), 'innerHTML', formatScore(p2Label, game.players[1].score));

  const scoreP2Wrap1 = el('scoreP2Wrap1');
  if (scoreP2Wrap1) {
    const want = game.twoPlayer ? 'shown' : 'hidden';
    const memo = lastWritten.get(scoreP2Wrap1);
    if (!memo || memo.hiddenState !== want) {
      setHidden(scoreP2Wrap1, !game.twoPlayer);
      if (memo) memo.hiddenState = want;
      else lastWritten.set(scoreP2Wrap1, { hiddenState: want });
    }
  }

  // Time display: time left in a windowed match, time elapsed in an endless one.
  // The tutorial has no clock at all, and says so with `clockText`.
  const timeStr = clockText ?? formatClock(
    game.matchLen > 0 ? Math.max(0, game.matchLen - game.matchT) : game.matchT
  );

  write(el('time1'), 'textContent', timeStr);
  write(el('time2'), 'textContent', timeStr);
}

/**
 * `notes` lets the caller add what only it knows — a record set, where the AI
 * ladder goes next — to player 1's card: a headline in place of the card's own,
 * and lines under the breakdown. Escaped here, so callers pass plain text.
 */
function escapeHtml(t: string): string {
  return t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/**
 * The next match's mode, offered on a duel's results card. Only the winner gets
 * it, with Play again; on a draw both players do.
 */
export interface ModePicker {
  choices: { id: string; label: string }[];
  current(): string;
  pick(id: string): void;
}

export function endMatchUI(game: Game, onRestart: () => void, notes?: ResultNotes, modes?: ModePicker) {
  game.matchOver = true;
  game.matchRunning = false;
  game.flashes = [];
  game.pops = [];
  fadeDroneForResults(true);

  const a = game.players[0], b = game.players[1];
  const solo = !game.twoPlayer;

  const cell = (pts: number, count: number) => (count ? String(pts) : '\u2013');

  const rows: [string, (p: any) => string][] = [
    [t('res.total'), (p: any) => '<b>' + p.score + '</b>'],
    [t('res.connections'), (p: any) => cell(p.lockPts || 0, p.locks)],
    [t('res.booms'), (p: any) => cell(p.boomPts || 0, p.booms)],
    [t('res.knocked'), (p: any) => cell(p.peelPts || 0, p.peels)],
  ];

  const them = game.aiOn ? (AI_LEVELS[game.aiLevel]?.label ?? 'AI') : 'P2';
  const me = game.aiOn ? escapeHtml(t('hud.you')) : 'P1';
  const head = solo ? '<tr><th></th><th class="p1">' + escapeHtml(t('hud.you')) + '</th></tr>'
                    : '<tr><th></th><th class="p1">' + me + '</th><th class="p2">' + them + '</th></tr>';
  const body = rows
    .map(
      ([label, get], i) =>
        '<tr' + (i === 0 ? ' class="total"' : '') + '><td>' + escapeHtml(label) + '</td>' +
        '<td class="p1">' + get(a) + '</td>' +
        (solo ? '' : '<td class="p2">' + get(b) + '</td>') + '</tr>'
    )
    .join('');

  const agi = againstAgi(game);
  const duel = !solo && !game.aiOn;
  const modeLabel = () => (modes ? modes.choices.find(c => c.id === modes.current())?.label ?? '' : '');

  function makeCard(pIndex: number): string {
    let titleText: string;
    let titleColor: string;
    let epic = false;

    if (solo) {
      titleText = t('res.score');
      titleColor = P_COLOR[0];
    } else if (a.score === b.score) {
      titleText = t('res.draw');
      titleColor = P_COLOR[pIndex];
    } else {
      const winnerIndex = a.score > b.score ? 0 : 1;
      if (pIndex === winnerIndex) {
        // Beating the top of the ladder is the game's biggest ending.
        titleText = agi ? t('res.beatAgi') : t('res.won');
        titleColor = P_COLOR[pIndex];
        epic = agi;
      } else {
        titleText = agi ? t('res.gameOver') : t('res.lost');
        titleColor = P_COLOR[pIndex];
      }
    }

    const mine = pIndex === 0 && notes;
    if (mine && notes!.title) titleText = notes!.title;
    const extra = mine ? notes!.lines.map(l => '<p class="result-note">' + escapeHtml(l) + '</p>').join('') : '';

    // In a duel the winner decides what comes next; the loser's card is only the score.
    const decides = !duel || a.score === b.score || (a.score > b.score ? 0 : 1) === pIndex;
    // Mode and Play again share one row, so two cards still fit a short phone on a draw.
    const picker = duel && modes
      ? '<div class="mode-pick" aria-label="' + escapeHtml(t('res.modes')) + '">' +
        '<button class="mode-step" data-step="-1" aria-label="' + escapeHtml(t('res.prevMode')) + '">\u2039</button>' +
        '<b class="mode-name">' + escapeHtml(modeLabel()) + '</b>' +
        '<button class="mode-step" data-step="1" aria-label="' + escapeHtml(t('res.nextMode')) + '">\u203a</button></div>'
      : '';
    const again = '<button class="again">' + escapeHtml(t('res.again')) + '</button>';

    return (
      '<h2' + (epic ? ' class="epic"' : '') + ' style="color:' + titleColor + '">' + escapeHtml(titleText) + '</h2>' +
      '<table>' + head + body + '</table>' +
      extra +
      (decides ? (picker ? '<div class="card-actions">' + picker + again + '</div>' : again) : '')
    );
  }

  const c1 = document.getElementById('overcard1'), c2 = document.getElementById('overcard2');
  if (c1) c1.innerHTML = makeCard(0);
  if (solo || game.aiOn) {
    setHidden(c2, true);
  } else {
    if (c2) {
      c2.innerHTML = makeCard(1);
      setHidden(c2, false);
    }
  }

  const overEl = document.getElementById('over');
  if (overEl) {
    setHidden(overEl, false);
    // The listener is bound once; what it calls is refreshed on every result.
    (overEl as any)._restart = onRestart;
    (overEl as any)._modes = modes;
    if (!(overEl as any)._boundRestart && overEl.addEventListener) {
      (overEl as any)._boundRestart = true;
      overEl.addEventListener('click', e => {
        const target = e.target as HTMLElement;
        const step = target?.closest('.mode-step') as HTMLElement | null;
        const m = (overEl as any)._modes as ModePicker | undefined;
        if (step && m) {
          initAudio();
          const i = m.choices.findIndex(c => c.id === m.current());
          const n = m.choices.length;
          const next = m.choices[(i + Number(step.dataset.step) + n) % n];
          m.pick(next.id);
          // On a draw both cards show the mode; keep them saying the same thing.
          for (const el of overEl.querySelectorAll('.mode-name')) el.textContent = next.label;
        } else if (target?.closest('.again')) {
          initAudio();
          (overEl as any)._restart();
        }
      });
    }
  }
}


