import { describe, it, expect } from 'vitest';
import { bothReady, needsSeatCard, newSeatState, seatCopy, tapHalf } from '../../src/ui/SeatCard';
import { CORE_RULES } from '../../src/ui/RulesText';

describe('the seat card', () => {
  it('appears only when two people share the device', () => {
    expect(needsSeatCard('duel')).toBe(true);
    expect(needsSeatCard('ai')).toBe(false);
    expect(needsSeatCard('solo')).toBe(false);
  });

  it('waits for both halves, in either order', () => {
    for (const order of [[0, 1], [1, 0]] as (0 | 1)[][]) {
      let s = newSeatState();
      s = tapHalf(s, order[0]);
      expect(bothReady(s)).toBe(false);
      s = tapHalf(s, order[1]);
      expect(bothReady(s)).toBe(true);
    }
  });

  it('does not start on the same half tapped twice', () => {
    let s = newSeatState();
    s = tapHalf(s, 0);
    s = tapHalf(s, 0);
    expect(bothReady(s)).toBe(false);
  });

  it('tells each player where to aim, and the five rules', () => {
    const c = seatCopy();
    expect(c.title).toMatch(/half is yours/);
    expect(c.lines.join(' ')).toMatch(/drag in it/i);
    expect([...c.rules]).toEqual([...CORE_RULES]);
  });
});
