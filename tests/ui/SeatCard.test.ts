import { describe, it, expect, afterEach } from 'vitest';
import { bothReady, createSeatCard, needsSeatCard, newSeatState, seatCopy, tapHalf } from '../../src/ui/SeatCard';
import { setLanguage, t } from '../../src/i18n/I18n';
import { coreRules } from '../../src/ui/RulesText';

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
    expect([...c.rules]).toEqual(coreRules());
  });

  describe('in the language chosen after start-up', () => {
    // The card is built when the game starts, before a language other than
    // English has loaded. It took its words then, so a player who had picked
    // Portuguese still read the vs Friend card in English (Tony, 2026-09-30).
    afterEach(async () => {
      await setLanguage('en');
      delete (globalThis as any).document;
    });

    /** Just enough of a DOM for the card: its two halves and its frame. */
    function fakeDom() {
      const node = (): any => {
        const n: any = {
          children: [] as any[], className: '', textContent: '', attrs: {} as Record<string, string>,
          classList: { toggle() {} },
          appendChild(c: any) { n.children.push(c); return c; },
          querySelector(sel: string) { return n.children.find((c: any) => '.' + c.className === sel) ?? null; },
          addEventListener() {},
          setAttribute(k: string, v: string) { n.attrs[k] = v; },
          removeAttribute(k: string) { delete n.attrs[k]; },
        };
        Object.defineProperty(n, 'innerHTML', { set() { n.children = []; } });
        return n;
      };
      const els: Record<string, any> = { 'seat-top': node(), 'seat-bottom': node(), 'seat-card': node() };
      (globalThis as any).document = {
        getElementById: (id: string) => els[id] ?? null, createElement: () => node(),
        documentElement: {}, querySelectorAll: () => [],
      };
      return els;
    }

    it('reads its words when it is shown, not when it is built', async () => {
      const els = fakeDom();
      const card = createSeatCard(() => {});
      await setLanguage('pt');
      card.show();
      const title = els['seat-bottom'].children.find((c: any) => c.className === 'seat-title');
      expect(title.textContent).toBe(t('seat.title'));
      expect(title.textContent).not.toMatch(/half is yours/);
    });
  });
});
