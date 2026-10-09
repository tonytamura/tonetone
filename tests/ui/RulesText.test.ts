import { describe, it, expect } from 'vitest';
import { t } from '../../src/i18n/I18n';
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

  it('describes the fire option and the mode in force', () => {
    const row = (rows: { label: string; text: string }[], l: string) => rows.find(r => r.label === l)!.text;
    expect(row(ruleRows(false), 'Aim')).toBe(t('rules.aim.text'));
    expect(row(ruleRows(true), 'Aim')).toBe(t('rules.aim.text.release'));
    expect(row(ruleRows(false), 'Two players')).toBe(t('rules.two.text'));
    expect(row(ruleRows(true), 'Two players')).toBe(t('rules.two.text.release'));
    // A pair booms on Normal; on the 3+ presets the rule says otherwise.
    expect(row(ruleRows(false, 2), 'Boom')).toBe(t('rules.boom.text'));
    expect(row(ruleRows(false, 3), 'Boom')).toBe(t('rules.boom.text') + ' ' + t('rules.boom.min', { n: 3 }));
  });

  it('closes the tutorial on the player\'s own fire option, not the default it played on', () => {
    expect(closingCard(120, true).lines[0]).toBe(t('rules.core.1.release'));
    expect(closingCard(120, false).lines[0]).toBe(t('rules.core.1'));
  });
});
