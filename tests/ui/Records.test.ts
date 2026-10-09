import { describe, it, expect } from 'vitest';
import { KeyValueStore } from '../../src/ui/Progress';
import { RECORDS_KEY, loadRecords, saveRecords, submitScore } from '../../src/ui/Records';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

describe('records', () => {
  it('start empty', () => {
    expect(loadRecords(memoryStore())).toEqual({ solo: {}, ai: {}, duel: {}, vsAi: {} });
  });

  it('call the first scored match a new record, and keep it', () => {
    const s = memoryStore();
    expect(submitScore('solo', 'normal', 420, s)).toEqual({ isNew: true, best: 420, previous: null });
    expect(loadRecords(s).solo.normal).toBe(420);
  });

  it('say "new" only when the stored best is beaten', () => {
    const s = memoryStore();
    submitScore('solo', 'normal', 420, s);
    expect(submitScore('solo', 'normal', 300, s)).toEqual({ isNew: false, best: 420, previous: 420 });
    expect(submitScore('solo', 'normal', 420, s).isNew).toBe(false); // a tie is not a new record
    expect(submitScore('solo', 'normal', 421, s)).toEqual({ isNew: true, best: 421, previous: 420 });
  });

  it('keep each preset, and each AI, apart', () => {
    const s = memoryStore();
    submitScore('solo', 'normal', 500, s);
    expect(submitScore('solo', 'chaos', 100, s).isNew).toBe(true);
    submitScore('ai', 'ai3', 250, s);
    expect(loadRecords(s)).toEqual({ solo: { normal: 500, chaos: 100 }, ai: { ai3: 250 }, duel: {}, vsAi: {} });
  });

  it('never set a record from nothing', () => {
    const s = memoryStore();
    expect(submitScore('solo', 'normal', 0, s)).toEqual({ isNew: false, best: 0, previous: null });
    expect(s.data.has(RECORDS_KEY)).toBe(false);
  });

  it('read corrupt, foreign or hostile values as no records', () => {
    for (const raw of ['{not json', '{"v":99,"solo":{"normal":5}}', '"x"', 'null']) {
      const s = memoryStore();
      s.data.set(RECORDS_KEY, raw);
      expect(loadRecords(s), raw).toEqual({ solo: {}, ai: {}, duel: {}, vsAi: {} });
    }
    const s = memoryStore();
    s.data.set(RECORDS_KEY, JSON.stringify({ v: 1, solo: { normal: -3, relax: 'lots', chaos: 12.7, drift: Infinity }, ai: [] }));
    expect(loadRecords(s)).toEqual({ solo: { chaos: 12 }, ai: {}, duel: {}, vsAi: {} });
  });

  it('survive a store that throws', () => {
    const broken: KeyValueStore = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    expect(loadRecords(broken)).toEqual({ solo: {}, ai: {}, duel: {}, vsAi: {} });
    expect(() => saveRecords({ solo: { normal: 1 }, ai: {} }, broken)).not.toThrow();
    expect(submitScore('solo', 'normal', 50, broken).isNew).toBe(true);
    expect(submitScore('solo', 'normal', 50, null).isNew).toBe(true);
  });
});

import { aiBestKey, recordMatch, recordSections, soloRecordNotes, winShare } from '../../src/ui/Records';

describe('the results card', () => {
  it('says "New highest score" only when a record is set', () => {
    expect(soloRecordNotes({ isNew: true, best: 420, previous: null }, 'Normal')).toEqual({ title: 'New highest score', lines: ['Normal · first record'] });
    expect(soloRecordNotes({ isNew: true, best: 500, previous: 420 }, 'Normal')).toEqual({ title: 'New highest score', lines: ['Normal · previous 420'] });
    const plain = soloRecordNotes({ isNew: false, best: 500, previous: 500 }, 'Chaos');
    expect(plain.title).toBeUndefined();
    expect(plain.lines).toEqual(['Highest score on Chaos: 500']);
  });

  it('says nothing about a best that does not exist', () => {
    expect(soloRecordNotes({ isNew: false, best: 0, previous: null }, 'Normal')).toEqual({ lines: [] });
  });

  it('names a Custom slot like any mode', () => {
    expect(soloRecordNotes({ isNew: true, best: 300, previous: null }, 'Custom 2').lines).toEqual(['Custom 2 · first record']);
  });
});

describe('match tallies', () => {
  it('count a win for whoever scored more, and a draw', () => {
    const s = memoryStore();
    recordMatch('duel', 'chaos', 500, 300, s);
    recordMatch('duel', 'chaos', 200, 300, s);
    recordMatch('duel', 'chaos', 400, 100, s);
    expect(recordMatch('duel', 'chaos', 250, 250, s)).toEqual({ p1: 2, p2: 1, draws: 1 });
    recordMatch('vsAi', 'agi', 100, 900, s);
    expect(loadRecords(s).vsAi).toEqual({ agi: { p1: 0, p2: 1, draws: 0 } });
    expect(loadRecords(s).duel.normal).toBeUndefined();
  });

  it('give player 1\'s share of the decided matches, and a dash while none is decided', () => {
    expect(winShare({ p1: 2, p2: 1, draws: 5 })).toBe('67%');
    expect(winShare({ p1: 0, p2: 0, draws: 3 })).toBe('–');
    expect(winShare(undefined)).toBe('–');
  });

  it('survive a stored table they cannot read', () => {
    const s = memoryStore();
    s.data.set(RECORDS_KEY, JSON.stringify({ v: 1, solo: { normal: 9 }, duel: { chaos: { p1: 'x', p2: -2, draws: 1.7 }, relax: 4 } }));
    expect(loadRecords(s)).toEqual({ solo: { normal: 9 }, ai: {}, duel: { chaos: { p1: 0, p2: 0, draws: 1 } }, vsAi: {} });
  });

  it('keep what the old format stored', () => {
    const s = memoryStore();
    s.data.set(RECORDS_KEY, JSON.stringify({ v: 1, solo: { normal: 420 }, ai: { ai2: 610 } }));
    expect(loadRecords(s)).toEqual({ solo: { normal: 420 }, ai: { ai2: 610 }, duel: {}, vsAi: {} });
  });
});

describe('the Records screen', () => {
  const modes = [{ id: 'normal', label: 'Normal' }, { id: 'chaos', label: 'Chaos' }, { id: 'custom1', label: 'Custom 1' }];
  const ais = [{ id: 'ai1', label: 'AI1' }, { id: 'agi', label: 'AGI' }];
  const records = {
    solo: { chaos: 90, custom1: 40 }, ai: { agi: 1500 },
    duel: { custom1: { p1: 3, p2: 1, draws: 0 } }, vsAi: { agi: { p1: 1, p2: 3, draws: 0 } },
  };

  it('lists only the solo modes that have a record, Custom slots included', () => {
    const [solo] = recordSections(records, modes, ais, 0);
    expect(solo.rows).toEqual([{ label: 'Chaos', values: ['90'] }, { label: 'Custom 1', values: ['40'] }]);
    const [none] = recordSections({ ...records, solo: {} }, modes, ais, 0);
    expect(none.rows).toEqual([]);
    expect(none.empty).toBe('No matches yet');
  });

  it('lists only the two-player modes that have results: P1 and P2 wins, and P1\'s share', () => {
    const [, duel] = recordSections(records, modes, ais, 0);
    expect(duel.columns).toEqual(['P1', 'P2', 'P1 %']);
    expect(duel.rows).toEqual([{ label: 'Custom 1', values: ['3', '1', '75%'] }]);
    const [, none] = recordSections({ ...records, duel: {} }, modes, ais, 0);
    expect(none.rows).toEqual([]);
    expect(none.empty).toBe('No matches yet');
  });

  it('gives every AI both sides\' wins and the player\'s share, in the match\'s names and colours, and marks the next', () => {
    const [, , vsAi] = recordSections(records, modes, ais, 1);
    expect(vsAi.columns).toEqual(['YOU', 'AI', '%']);
    expect(vsAi.seats).toEqual([0, 1, 0]);
    expect(vsAi.rows).toEqual([
      { label: 'AI1', values: ['–', '–', '–'] },
      { label: 'AGI', note: 'next', values: ['1', '3', '25%'] },
    ]);
  });

  it('keeps the best against each AI per mode, and shows only the modes that have one', () => {
    const withBests = { ...records, ai: { 'normal:agi': 1500, 'chaos:ai1': 300, 'chaos:agi': 700, agi: 999 } };
    const [, , , best] = recordSections(withBests, modes, ais, 0);
    expect(best.columns).toEqual(['AI1', 'AGI']);
    expect(best.rows).toEqual([
      { label: 'Normal', values: ['–', '1500'] },
      { label: 'Chaos', values: ['300', '700'] },
    ]);
    const [, , , none] = recordSections(records, modes, ais, 0); // a bare id from before is not shown
    expect(none.rows).toEqual([]);
    expect(none.empty).toBe('No matches yet');
  });

  it('stores a best against an AI per mode', () => {
    const s = memoryStore();
    submitScore('ai', aiBestKey('normal', 'ai3'), 400, s);
    expect(submitScore('ai', aiBestKey('chaos', 'ai3'), 100, s).isNew).toBe(true);
    expect(loadRecords(s).ai).toEqual({ 'normal:ai3': 400, 'chaos:ai3': 100 });
  });
});

import { LADDER_KEY, ladderNotes, loadLadderLevel, saveLadderLevel } from '../../src/ui/Records';

describe('the AI ladder on this device', () => {
  it('starts on the first rung and keeps where it got to', () => {
    const s = memoryStore();
    expect(loadLadderLevel(10, s)).toBe(0);
    saveLadderLevel(4, s);
    expect(loadLadderLevel(10, s)).toBe(4);
  });

  it('reads a stored rung the ladder no longer has as the first', () => {
    const s = memoryStore();
    for (const raw of ['{"v":1,"level":12}', '{"v":1,"level":-1}', '{"v":1,"level":2.5}', 'x', '{"v":9,"level":3}']) {
      s.data.set(LADDER_KEY, raw);
      expect(loadLadderLevel(10, s), raw).toBe(0);
    }
  });

  it('says where the next match goes, and the best against this AI', () => {
    const none = { isNew: false, best: 0, previous: null };
    expect(ladderNotes('AI3', 'AI4', 'up', false, none).lines).toEqual(['Next: AI4']);
    expect(ladderNotes('AI3', 'AI2', 'down', false, none).lines).toEqual(['Back to AI2']);
    expect(ladderNotes('AI3', 'AI3', 'stay', false, none).lines).toEqual(['Again: AI3']);
    expect(ladderNotes('AI4', 'AI4', 'stay', false, { isNew: true, best: 700, previous: 650 }, 'Normal').lines)
      .toEqual(['Again: AI4', 'New best against AI4 on Normal: 700']);
    expect(ladderNotes('AI4', 'AI5', 'up', false, { isNew: false, best: 900, previous: 900 }, 'Chaos').lines)
      .toEqual(['Next: AI5', 'Best against AI4 on Chaos: 900']);
  });
});
