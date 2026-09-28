import { describe, it, expect } from 'vitest';
import { KeyValueStore, TUTORIAL_KEY, hasSeenTutorial, markTutorialSeen } from '../../src/ui/Progress';
import { shouldOfferTutorial } from '../../src/ui/FirstPlay';
import { menuItems } from '../../src/ui/menu/MenuLayout';
import { PlayMode } from '../../src/game/GameState';

function memoryStore(): KeyValueStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
}

const MODES: PlayMode[] = ['solo', 'ai', 'duel'];

describe('the tutorial is offered once per device', () => {
  it('is unseen on a fresh device, and seen once marked', () => {
    const store = memoryStore();
    expect(hasSeenTutorial(store)).toBe(false);
    markTutorialSeen(store);
    expect(hasSeenTutorial(store)).toBe(true);
    expect(store.data[TUTORIAL_KEY]).toBe('done');
  });

  it('is offered for every mode while unseen, and for none once seen', () => {
    for (const mode of MODES) {
      expect(shouldOfferTutorial(false, mode), mode).toBe(true);
      expect(shouldOfferTutorial(true, mode), mode).toBe(false);
    }
  });

  it('never lets broken storage stop the game', () => {
    // A private window, or storage blocked outright: reads and writes throw.
    const broken: KeyValueStore = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(hasSeenTutorial(broken)).toBe(false);
    expect(() => markTutorialSeen(broken)).not.toThrow();
    // No storage at all behaves the same: offered again, nothing thrown.
    expect(hasSeenTutorial(null)).toBe(false);
    expect(() => markTutorialSeen(null)).not.toThrow();
  });

  it('keeps the menu at four items: the help button is not one of them', () => {
    expect(menuItems).toHaveLength(4);
  });
});
