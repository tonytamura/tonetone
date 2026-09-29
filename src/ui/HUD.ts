import { Game } from '../game/GameState';
import { P_COLOR } from '../graphics/Renderer';
import { initAudio, fadeDroneForResults } from '../audio/SynthEngine';
import { formatClock } from '../game/Clock';
import { setHidden } from './Dom';
import { ResultNotes } from './Records';
import { AI_LEVELS, againstAgi } from '../game/AI';

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
  const p1Label = game.aiOn ? 'YOU' : (game.twoPlayer ? 'P1' : 'SCORE');
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

export function endMatchUI(game: Game, onRestart: () => void, notes?: ResultNotes) {
  game.matchOver = true;
  game.matchRunning = false;
  game.flashes = [];
  game.pops = [];
  fadeDroneForResults(true);

  const a = game.players[0], b = game.players[1];
  const solo = !game.twoPlayer;

  const cell = (pts: number, count: number) => (count ? String(pts) : '\u2013');

  const rows: [string, (p: any) => string][] = [
    ['total', (p: any) => '<b>' + p.score + '</b>'],
    ['connections', (p: any) => cell(p.lockPts || 0, p.locks)],
    ['booms', (p: any) => cell(p.boomPts || 0, p.booms)],
    ['knocked loose', (p: any) => cell(p.peelPts || 0, p.peels)],
  ];

  const them = game.aiOn ? (AI_LEVELS[game.aiLevel]?.label ?? 'AI') : 'P2';
  const me = game.aiOn ? 'YOU' : 'P1';
  const head = solo ? '<tr><th></th><th class="p1">YOU</th></tr>'
                    : '<tr><th></th><th class="p1">' + me + '</th><th class="p2">' + them + '</th></tr>';
  const body = rows
    .map(
      ([label, get], i) =>
        '<tr' + (i === 0 ? ' class="total"' : '') + '><td>' + label + '</td>' +
        '<td class="p1">' + get(a) + '</td>' +
        (solo ? '' : '<td class="p2">' + get(b) + '</td>') + '</tr>'
    )
    .join('');

  const agi = againstAgi(game);

  function makeCard(pIndex: number): string {
    let titleText: string;
    let titleColor: string;
    let epic = false;

    if (solo) {
      titleText = 'Score';
      titleColor = P_COLOR[0];
    } else if (a.score === b.score) {
      titleText = 'Draw';
      titleColor = P_COLOR[pIndex];
    } else {
      const winnerIndex = a.score > b.score ? 0 : 1;
      if (pIndex === winnerIndex) {
        // Beating the top of the ladder is the game's biggest ending.
        titleText = agi ? 'You Beat AGI' : 'You Won';
        titleColor = P_COLOR[pIndex];
        epic = agi;
      } else {
        titleText = agi ? 'Game Over' : 'You Lost';
        titleColor = P_COLOR[pIndex];
      }
    }

    const mine = pIndex === 0 && notes;
    if (mine && notes!.title) titleText = notes!.title;
    const extra = mine ? notes!.lines.map(l => '<p class="result-note">' + escapeHtml(l) + '</p>').join('') : '';

    return (
      '<h2' + (epic ? ' class="epic"' : '') + ' style="color:' + titleColor + '">' + escapeHtml(titleText) + '</h2>' +
      '<table>' + head + body + '</table>' +
      extra +
      '<button class="again">Play again</button>'
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
    if (!(overEl as any)._boundRestart && overEl.addEventListener) {
      (overEl as any)._boundRestart = true;
      overEl.addEventListener('click', e => {
        const target = e.target as HTMLElement;
        if (target && target.closest('button')) {
          initAudio();
          onRestart();
        }
      });
    }
  }
}


