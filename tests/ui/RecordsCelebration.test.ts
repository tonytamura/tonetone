import { describe, it, expect } from 'vitest';
import { OPENING_BOOMS_MS, recordWords } from '../../src/ui/RecordsCelebration';
import { emptyRecords } from '../../src/ui/Records';

const AIS = [{ id: 'ai1', label: 'AI1' }, { id: 'ai2', label: 'AI2' }, { id: 'ai3', label: 'AI3' }, { id: 'agi', label: 'AGI' }];

describe('the Records celebration', () => {
  it('floats the player\'s own numbers: best solo score, best share of wins, highest AI beaten', () => {
    const r = {
      ...emptyRecords(),
      solo: { normal: 1840, chaos: 2210 },
      duel: { normal: { p1: 7, p2: 5, draws: 1 } },
      vsAi: { ai1: { p1: 9, p2: 1, draws: 0 }, ai3: { p1: 1, p2: 4, draws: 0 }, agi: { p1: 0, p2: 3, draws: 0 } },
    };
    expect(recordWords(r, AIS)).toEqual(['2210!', '90%!', 'AI3!']);
  });

  it('has no words to float before there are records', () => {
    expect(recordWords(emptyRecords(), AIS)).toEqual([]);
  });

  it('leaves out a share or an AI the player has never won against', () => {
    const r = { ...emptyRecords(), solo: { relax: 300 }, vsAi: { agi: { p1: 0, p2: 2, draws: 1 } } };
    expect(recordWords(r, AIS)).toEqual(['300!']);
  });

  it('opens with a few booms, a beat apart, all within about a second', () => {
    expect(OPENING_BOOMS_MS.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...OPENING_BOOMS_MS)).toBeLessThanOrEqual(1000);
  });
});
