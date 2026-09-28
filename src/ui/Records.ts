/**
 * The player's records: the best solo score on each preset, and the best score
 * against each AI.
 *
 * Solo records are kept per preset because the presets are different games:
 * Chaos lasts one minute and Relax three, so one number across them would only
 * reward the longest. A match played with knobs that match no preset sets no
 * record — its settings could be anything.
 *
 * Stored as one versioned JSON value under `toneboom.records`, through the same
 * guarded store as the tutorial flag: a missing, wiped or corrupt value reads as
 * no records, and a failed write loses only the record, never the game.
 */
import { KeyValueStore, deviceStore } from './Progress';

export const RECORDS_KEY = 'toneboom.records';
const VERSION = 1;

export interface Records {
  /** Best solo score by preset id. */
  solo: Record<string, number>;
  /** Best score against each AI, by level id. */
  ai: Record<string, number>;
}

export function emptyRecords(): Records {
  return { solo: {}, ai: {} };
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
    return { solo: cleanTable(parsed.solo), ai: cleanTable(parsed.ai) };
  } catch {
    return emptyRecords();
  }
}

export function saveRecords(records: Records, store: KeyValueStore | null = deviceStore()): void {
  try {
    store?.setItem(RECORDS_KEY, JSON.stringify({ v: VERSION, solo: records.solo, ai: records.ai }));
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

/** What the results card adds for a match: a headline in place of its own, and lines under the table. */
export interface ResultNotes {
  title?: string;
  lines: string[];
}

/**
 * The solo results' words about the record. "New highest score" replaces the
 * card's "Score" headline only when a record was actually set; otherwise the
 * best stands as a line under the breakdown. `result` is null when the match
 * was played on settings that match no preset, and so set no record.
 */
export function soloRecordNotes(result: RecordResult | null, presetLabel: string | null): ResultNotes {
  if (!result || !presetLabel) return { lines: ['Custom settings set no record.'] };
  if (result.isNew) {
    return {
      title: 'New highest score',
      lines: [result.previous === null ? `${presetLabel} · first record` : `${presetLabel} · previous ${result.previous}`],
    };
  }
  return { lines: result.best > 0 ? [`Highest score on ${presetLabel}: ${result.best}`] : [] };
}

export interface RecordSection {
  title: string;
  rows: { label: string; value: string }[];
}

/**
 * The Records screen's content: one row per preset, in the picker's order, and
 * a dash for any not yet played. `extra` lets another part of the game (the AI
 * ladder) add its own section.
 */
export function recordSections(
  records: Records, presets: { id: string; label: string }[], extra: RecordSection[] = []
): RecordSection[] {
  const dash = '–';
  return [
    { title: 'Solo — highest score', rows: presets.map(p => ({ label: p.label, value: p.id in records.solo ? String(records.solo[p.id]) : dash })) },
    ...extra,
  ];
}
