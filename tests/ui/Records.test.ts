import { describe, it, expect } from 'vitest';
import { KeyValueStore } from '../../src/ui/Progress';
import { RECORDS_KEY, loadRecords, saveRecords, submitScore } from '../../src/ui/Records';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

describe('records', () => {
  it('start empty', () => {
    expect(loadRecords(memoryStore())).toEqual({ solo: {}, ai: {} });
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
    expect(loadRecords(s)).toEqual({ solo: { normal: 500, chaos: 100 }, ai: { ai3: 250 } });
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
      expect(loadRecords(s), raw).toEqual({ solo: {}, ai: {} });
    }
    const s = memoryStore();
    s.data.set(RECORDS_KEY, JSON.stringify({ v: 1, solo: { normal: -3, relax: 'lots', chaos: 12.7, drift: Infinity }, ai: [] }));
    expect(loadRecords(s)).toEqual({ solo: { chaos: 12 }, ai: {} });
  });

  it('survive a store that throws', () => {
    const broken: KeyValueStore = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    expect(loadRecords(broken)).toEqual({ solo: {}, ai: {} });
    expect(() => saveRecords({ solo: { normal: 1 }, ai: {} }, broken)).not.toThrow();
    expect(submitScore('solo', 'normal', 50, broken).isNew).toBe(true);
    expect(submitScore('solo', 'normal', 50, null).isNew).toBe(true);
  });
});

import { recordSections, soloRecordNotes } from '../../src/ui/Records';

describe('the results card', () => {
  it('says "New highest score" only when a record is set', () => {
    expect(soloRecordNotes({ isNew: true, best: 420, previous: null }, 'Normal')).toEqual({ title: 'New highest score', lines: ['Normal · first record'] });
    expect(soloRecordNotes({ isNew: true, best: 500, previous: 420 }, 'Normal')).toEqual({ title: 'New highest score', lines: ['Normal · previous 420'] });
    const plain = soloRecordNotes({ isNew: false, best: 500, previous: 500 }, 'Chaos');
    expect(plain.title).toBeUndefined();
    expect(plain.lines).toEqual(['Highest score on Chaos: 500']);
  });

  it('says nothing about a best that does not exist, and why custom settings set none', () => {
    expect(soloRecordNotes({ isNew: false, best: 0, previous: null }, 'Normal')).toEqual({ lines: [] });
    expect(soloRecordNotes(null, null)).toEqual({ lines: ['Custom settings set no record.'] });
  });
});

describe('the Records screen', () => {
  it('lists every preset in order, with a dash for the unplayed', () => {
    const [solo] = recordSections({ solo: { chaos: 90 }, ai: {} }, [{ id: 'normal', label: 'Normal' }, { id: 'chaos', label: 'Chaos' }]);
    expect(solo.rows).toEqual([{ label: 'Normal', value: '–' }, { label: 'Chaos', value: '90' }]);
  });
});
