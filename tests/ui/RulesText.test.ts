import { describe, it, expect } from 'vitest';
import { coreRules, ruleRows } from '../../src/ui/RulesText';
import { seatCopy } from '../../src/ui/SeatCard';
import { closingCard } from '../../src/ui/TutorialUI';

describe('the rules are written once', () => {
  it('says the same five rules at the end of the tutorial and on the seat card', () => {
    expect(closingCard(120).lines).toEqual(coreRules());
    expect([...seatCopy().rules]).toEqual(coreRules());
  });

  it('covers every core rule on the help screen, black and white included', () => {
    const labels = ruleRows().map(r => r.label);
    for (const l of ['Aim', 'Lock', 'Boom', 'Black', 'White', 'Two players']) expect(labels).toContain(l);
    // The boom row says what the tutorial says: deep red, not just red.
    expect(ruleRows().find(r => r.label === 'Boom')!.text).toMatch(/deep red/);
  });
});
