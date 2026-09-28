import { describe, it, expect } from 'vitest';
import { CORE_RULES, RULE_ROWS } from '../../src/ui/RulesText';
import { seatCopy } from '../../src/ui/SeatCard';
import { closingCard } from '../../src/ui/TutorialUI';

describe('the rules are written once', () => {
  it('says the same five rules at the end of the tutorial and on the seat card', () => {
    expect(closingCard(120).lines).toEqual([...CORE_RULES]);
    expect([...seatCopy().rules]).toEqual([...CORE_RULES]);
  });

  it('covers every core rule on the help screen, black and white included', () => {
    const labels = RULE_ROWS.map(r => r.label);
    for (const l of ['Aim', 'Lock', 'Boom', 'Black', 'White', 'Two players']) expect(labels).toContain(l);
    // The boom row says what the tutorial says: deep red, not just red.
    expect(RULE_ROWS.find(r => r.label === 'Boom')!.text).toMatch(/deep red/);
  });
});
