import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { topStripFor } from '../../src/ui/ControlStrips';

describe('the top strip', () => {
  it('is absent in Solo, the AI deck alone against the AI, and a full strip for two players', () => {
    expect(topStripFor('solo')).toBe('none');
    expect(topStripFor('ai')).toBe('deck');
    expect(topStripFor('duel')).toBe('full');
  });

  it('hides the scores and the clock when it shows only the AI deck', () => {
    const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');
    const rule = css.match(/((?:#cue2\.deck-only [^,{]+,?\s*)+)\{\s*display:\s*none/);
    expect(rule, 'a display:none rule for #cue2.deck-only').not.toBeNull();
    for (const part of ['.score-p1', '.score-p2', '.bar-time']) expect(rule![1]).toContain(part);
  });

  it('is not rotated by the markup: the mode decides that', () => {
    // main.ts adds `flip` for two players only, so the AI deck reads from the
    // player's side.
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    expect(html).toMatch(/<div id="cue2" class="cue" hidden>/);
  });
});
