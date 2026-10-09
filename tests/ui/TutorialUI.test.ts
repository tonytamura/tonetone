import { describe, it, expect } from 'vitest';
import { t } from '../../src/i18n/I18n';
import { TUTORIAL_CLOCK, closingButton, closingCard, tutorialLine } from '../../src/ui/TutorialUI';
import { TutorialEvent, TUTORIAL_STEPS } from '../../src/game/Tutorial';

/**
 * The tutorial's words, held to the rules the design sets for them. They are
 * pure functions, so no DOM is needed to check them.
 */

const EVENTS: TutorialEvent[] = [
  ...TUTORIAL_STEPS.map(step => ({ type: 'step', step }) as TutorialEvent),
  { type: 'touched' },
  { type: 'firstLock' },
  { type: 'tooHard' },
  { type: 'peel' },
  ...TUTORIAL_STEPS.map(step => ({ type: 'again', step }) as TutorialEvent),
  ...TUTORIAL_STEPS.map(step => ({ type: 'hint', step }) as TutorialEvent),
  ...TUTORIAL_STEPS.map(step => ({ type: 'stepDone', step, lockPts: 11, boomPts: 27 }) as TutorialEvent),
];

// The names of ball colours. A colour name fails for colour-blind players, so
// the ring on the field points instead. Black and white are exempt: they are
// the two balls with names of their own, and they differ in brightness, not
// hue. The arrow's red is a cue, not a ball, and may be named too.
const BALL_COLOUR_WORDS = ['gold', 'yellow', 'purple', 'violet', 'pink', 'magenta', 'cyan', 'teal', 'green', 'blue', 'orange'];

function allText(): string[] {
  const out: string[] = [];
  for (const e of EVENTS) {
    const b = tutorialLine(e);
    if (b) { out.push(b.line); if (b.sub) out.push(b.sub); }
  }
  const c = closingCard(120);
  out.push(c.title, ...c.lines, c.small || '', closingButton('solo'), closingButton(null));
  return out;
}

describe('tutorial copy', () => {
  it('has a line for every event a step can raise', () => {
    for (const e of EVENTS) expect(tutorialLine(e), JSON.stringify(e)).not.toBeNull();
  });

  it('introduces all five steps, black and white included', () => {
    const intro = TUTORIAL_STEPS.map(step => tutorialLine({ type: 'step', step })!.line).join(' ');
    expect(intro).toMatch(/black/i);
    expect(intro).toMatch(/white/i);
  });

  it('never names a ball colour', () => {
    for (const text of allText()) {
      for (const word of BALL_COLOUR_WORDS) {
        expect(text.toLowerCase(), `"${text}" names ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`));
      }
    }
  });

  it('fits two short lines on a 360px phone', () => {
    // At the banner's 16px bold, a 360px phone carries about 34 characters a
    // line; a line and a sub at these lengths wrap to two lines each at most.
    for (const e of EVENTS) {
      const b = tutorialLine(e)!;
      expect(b.line.length, b.line).toBeLessThanOrEqual(60);
      if (b.sub) expect(b.sub.length, b.sub).toBeLessThanOrEqual(48);
    }
  });

  it('teaches deep red for the boom, never just red', () => {
    // Measured: a throw at the red threshold never booms the step 3 group.
    const boom = tutorialLine({ type: 'step', step: 'boom' })!;
    expect(boom.sub).toMatch(/deep red/);
    expect(allText().join(' ')).not.toMatch(/turns red/);
  });

  it('quotes what the player really earned when the group booms', () => {
    const b = tutorialLine({ type: 'stepDone', step: 'boom', lockPts: 9, boomPts: 41 })!;
    expect(b.line).toContain('+41');
    expect(b.sub).toContain('+9');
  });

  it('points at the hint when it shows, without naming a colour', () => {
    for (const step of TUTORIAL_STEPS) {
      const b = tutorialLine({ type: 'hint', step })!;
      expect(b.line).toBeTruthy();
      expect(b.sub).toMatch(/circle/);
    }
  });

  it('says a missed throw can simply be tried again', () => {
    for (const step of TUTORIAL_STEPS) expect(tutorialLine({ type: 'again', step })!.sub).toMatch(/again/i);
  });

  it('closes with the rules, the real match length and one button', () => {
    const c = closingCard(120);
    expect(c.lines).toHaveLength(5);
    expect(c.small).toBe('Most points in 2:00 wins.');
    expect(closingCard(180).small).toBe('Most points in 3:00 wins.');
    expect(closingCard(0).small).toBe('Most points wins.');
    // Solo has no one to beat.
    expect(closingCard(120, false, true).small).toBe(t('tut.card.smallSolo', { time: '2:00' }));
    // On the way into a mode, the button starts it; otherwise it goes back.
    expect(closingButton('solo')).toBe('Start game');
    expect(closingButton('duel')).toBe('Start game');
    expect(closingButton(null)).toBe('Back to menu');
  });

  it('shows no time on the clock', () => {
    expect(TUTORIAL_CLOCK).not.toMatch(/\d/);
  });
});
