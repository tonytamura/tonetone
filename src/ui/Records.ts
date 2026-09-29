/**
 * The player's records: the best solo score on each mode, who won the two-player
 * matches on each mode, and the best score and the wins against each AI.
 *
 * Solo records are kept per mode because the modes are different games: Chaos
 * lasts one minute and Relax three, so one number across them would only reward
 * the longest. The three Custom slots keep records too, each its own (since
 * 2026-09-29; before that a Custom match set none). A slot's record stands for
 * whatever the slot held when it was set.
 *
 * Stored as one versioned JSON value under `toneboom.records`, through the same
 * guarded store as the tutorial flag: a missing, wiped or corrupt value reads as
 * no records, and a failed write loses only the record, never the game.
 */
import { t } from '../i18n/I18n';
import { KeyValueStore, deviceStore } from './Progress';

export const RECORDS_KEY = 'toneboom.records';
const VERSION = 1;

/** How a run of matches went: wins for each side, and draws. */
export interface Tally {
  p1: number;
  /** Player 2 in a duel, the AI in a vs AI match. */
  p2: number;
  draws: number;
}

export interface Records {
  /** Best solo score by mode: a preset id or a Custom slot's. */
  solo: Record<string, number>;
  /** Best score against each AI, by level id; on a named preset only. */
  ai: Record<string, number>;
  /** Two-player results by mode. */
  duel: Record<string, Tally>;
  /** Results against each AI, by level id, whatever the mode. */
  vsAi: Record<string, Tally>;
}

export function emptyRecords(): Records {
  return { solo: {}, ai: {}, duel: {}, vsAi: {} };
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Keep only tallies made of whole, non-negative counts. */
function cleanTallies(t: unknown): Record<string, Tally> {
  const out: Record<string, Tally> = {};
  if (!t || typeof t !== 'object') return out;
  for (const [k, v] of Object.entries(t as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const tally = { p1: count(o.p1), p2: count(o.p2), draws: count(o.draws) };
    if (tally.p1 + tally.p2 + tally.draws > 0) out[k] = tally;
  }
  return out;
}

/** Keep only whole, finite, non-negative scores under string keys. */
function cleanTable(t: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!t || typeof t !== 'object') return out;
  for (const [k, v] of Object.entries(t as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = Math.floor(v);
  }
  return out;
}

export function loadRecords(store: KeyValueStore | null = deviceStore()): Records {
  try {
    const raw = store?.getItem(RECORDS_KEY);
    if (!raw) return emptyRecords();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== VERSION) return emptyRecords();
    return {
      solo: cleanTable(parsed.solo), ai: cleanTable(parsed.ai),
      duel: cleanTallies(parsed.duel), vsAi: cleanTallies(parsed.vsAi),
    };
  } catch {
    return emptyRecords();
  }
}

export function saveRecords(records: Records, store: KeyValueStore | null = deviceStore()): void {
  try {
    store?.setItem(RECORDS_KEY, JSON.stringify({ v: VERSION, ...records }));
  } catch {
    // The record is lost; the game is not.
  }
}

export interface RecordResult {
  /** This score beat the one stored, or is the first one stored. */
  isNew: boolean;
  /** The best after this score: this score if it is new. */
  best: number;
  /** What was stored before, if anything. */
  previous: number | null;
}

/**
 * Put `score` against the record at `table[key]`, store it if it beats it, and
 * say how it went. A score of 0 never sets a record: a match where nothing was
 * scored is not an achievement to announce.
 */
export function submitScore(
  table: 'solo' | 'ai', key: string, score: number, store: KeyValueStore | null = deviceStore()
): RecordResult {
  const records = loadRecords(store);
  const previous = key in records[table] ? records[table][key] : null;
  const isNew = score > 0 && (previous === null || score > previous);
  if (isNew) {
    records[table][key] = score;
    saveRecords(records, store);
  }
  return { isNew, best: isNew ? score : previous ?? 0, previous };
}

/**
 * Count one finished match in `table[key]`: a win for whoever scored more, or a
 * draw. Every match counts, whatever its score; the tallies are how the
 * matches went, not records to beat.
 */
export function recordMatch(
  table: 'duel' | 'vsAi', key: string, p1: number, p2: number, store: KeyValueStore | null = deviceStore()
): Tally {
  const records = loadRecords(store);
  const tally = records[table][key] ?? { p1: 0, p2: 0, draws: 0 };
  if (p1 > p2) tally.p1++;
  else if (p2 > p1) tally.p2++;
  else tally.draws++;
  records[table][key] = tally;
  saveRecords(records, store);
  return tally;
}

/** Player 1's share of the decided matches, as "64%", or a dash while none is decided. */
export function winShare(tally: Tally | undefined): string {
  const decided = tally ? tally.p1 + tally.p2 : 0;
  return decided ? `${Math.round((100 * tally!.p1) / decided)}%` : '–';
}

/** What the results card adds for a match: a headline in place of its own, and lines under the table. */
export interface ResultNotes {
  title?: string;
  lines: string[];
}

/**
 * The solo results' words about the record. "New highest score" replaces the
 * card's "Score" headline only when a record was actually set; otherwise the
 * best stands as a line under the breakdown.
 */
export function soloRecordNotes(result: RecordResult, modeLabel: string): ResultNotes {
  if (result.isNew) {
    return {
      title: t('rec.newHigh'),
      lines: [result.previous === null
        ? t('rec.first', { preset: modeLabel })
        : t('rec.previous', { preset: modeLabel, score: result.previous })],
    };
  }
  return { lines: result.best > 0 ? [t('rec.highestOn', { preset: modeLabel, score: result.best })] : [] };
}

export interface RecordSection {
  title: string;
  /** Column heads for the values, when a row has more than one. */
  columns?: string[];
  /** `note` is a small second line under the label, such as the ladder's "next". */
  rows: { label: string; values: string[]; note?: string }[];
  /** Said in place of the rows when there are none. */
  empty?: string;
}

/**
 * The Records screen's content:
 *
 * - Solo: the best score on every mode, in the picker's order, a dash for any
 *   not yet played.
 * - Two players: P1's and P2's wins and P1's share, on each mode that has been
 *   played; a mode with no results has no row.
 * - vs AI: on every rung, the best score, the player's and the AI's wins, and
 *   the player's share. `next` marks the rung the ladder plays next.
 */
export function recordSections(
  records: Records,
  modes: { id: string; label: string }[],
  ais: { id: string; label: string }[],
  next: number,
): RecordSection[] {
  const dash = '–';
  return [
    {
      title: t('records.solo'),
      rows: modes.map(m => ({ label: m.label, values: [m.id in records.solo ? String(records.solo[m.id]) : dash] })),
    },
    {
      title: t('records.duel'),
      columns: ['P1', 'P2', 'P1 %'],
      rows: modes.filter(m => records.duel[m.id]).map(m => {
        const tally = records.duel[m.id];
        return { label: m.label, values: [String(tally.p1), String(tally.p2), winShare(tally)] };
      }),
      empty: t('records.none'),
    },
    {
      title: t('records.ai'),
      columns: [t('records.best'), 'P1', 'AI', 'P1 %'],
      rows: ais.map((a, i) => {
        const tally = records.vsAi[a.id];
        return {
          label: a.label,
          ...(i === next ? { note: t('records.next') } : {}),
          values: [
            a.id in records.ai ? String(records.ai[a.id]) : dash,
            tally ? String(tally.p1) : dash,
            tally ? String(tally.p2) : dash,
            winShare(tally),
          ],
        };
      }),
    },
  ];
}

// --------------------------------------------------------------- the AI ladder

export const LADDER_KEY = 'toneboom.ladder';

/** The rung the next vs AI match is played against, as an index; the first rung when none is stored. */
export function loadLadderLevel(levels: number, store: KeyValueStore | null = deviceStore()): number {
  try {
    const raw = store?.getItem(LADDER_KEY);
    if (!raw) return 0;
    const p = JSON.parse(raw);
    const n = p && p.v === VERSION ? p.level : NaN;
    return Number.isInteger(n) && n >= 0 && n < levels ? n : 0;
  } catch {
    return 0;
  }
}

export function saveLadderLevel(level: number, store: KeyValueStore | null = deviceStore()): void {
  try {
    store?.setItem(LADDER_KEY, JSON.stringify({ v: VERSION, level }));
  } catch {
    // The next match starts from the first rung instead.
  }
}

/**
 * What the vs AI results card says: where the ladder goes next, and the best
 * score against this AI. The card's own "You Won" / "You Lost" / "Draw" stays.
 */
export function ladderNotes(
  played: string, next: string, direction: 'up' | 'down' | 'stay', atTop: boolean, record: RecordResult
): ResultNotes {
  const lines: string[] = [];
  if (direction === 'up') lines.push(t('ladder.next', { ai: next }));
  else if (direction === 'down') lines.push(t('ladder.back', { ai: next }));
  else lines.push(atTop ? t('ladder.top', { ai: played }) : t('ladder.again', { ai: next }));
  if (record.isNew) lines.push(t('ladder.newBest', { ai: played, score: record.best }));
  else if (record.best > 0) lines.push(t('ladder.best', { ai: played, score: record.best }));
  return { lines };
}
