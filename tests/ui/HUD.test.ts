import { describe, it, expect, beforeEach } from 'vitest';
import { createGame } from '../../src/game/GameState';
import { updateHUD, endMatchUI } from '../../src/ui/HUD';
import { P_COLOR } from '../../src/graphics/Renderer';

class MockElement {
  innerHTML: string = '';
  textContent: string = '';
  attributes: Record<string, string> = {};

  addEventListener(_type: string, _listener: any) {}
  setAttribute(name: string, val: string) {
    this.attributes[name] = val;
  }
  removeAttribute(name: string) {
    delete this.attributes[name];
  }
  hasAttribute(name: string): boolean {
    return name in this.attributes;
  }
  addEventListener(_type: string, _fn: any) {}
}

describe('updateHUD', () => {
  let elements: Record<string, MockElement>;

  beforeEach(() => {
    elements = {
      counts: new MockElement(),
      hudBig: new MockElement(),
      hudGroups: new MockElement(),
      hudBalls: new MockElement(),
      scoreP1: new MockElement(),
      scoreP1_2: new MockElement(),
      scoreP2_1: new MockElement(),
      scoreP2_2: new MockElement(),
      scoreP2Wrap1: new MockElement(),
      time1: new MockElement(),
      time2: new MockElement(),
    };

    (globalThis as any).document = {
      getElementById: (id: string) => elements[id] || null,
      querySelectorAll: (_sel: string) => [],
    };
  });

  it('updates scores and match time in the HUD bar for 1-player mode', () => {
    const game = createGame();
    game.twoPlayer = false;
    game.aiOn = false;
    game.matchLen = 180;
    game.matchT = 30;
    game.players[0].score = 45;

    updateHUD(game);

    expect(elements.scoreP1.innerHTML).toContain('SCORE');
    expect(elements.scoreP1.innerHTML).toContain('45');
    expect(elements.scoreP2Wrap1.hasAttribute('hidden')).toBe(true);
    expect(elements.time1.textContent).toBe('2:30');
  });

  it('updates scores for P1 and P2 in 2-player mode', () => {
    const game = createGame();
    game.twoPlayer = true;
    game.aiOn = false;
    game.matchLen = 180;
    game.matchT = 0;
    game.players[0].score = 60;
    game.players[1].score = 80;

    updateHUD(game);

    expect(elements.scoreP1.innerHTML).toContain('P1');
    expect(elements.scoreP1.innerHTML).toContain('60');
    expect(elements.scoreP2_1.innerHTML).toContain('P2');
    expect(elements.scoreP2_1.innerHTML).toContain('80');
    expect(elements.scoreP2Wrap1.hasAttribute('hidden')).toBe(false);
    expect(elements.time1.textContent).toBe('3:00');
  });
});

describe('endMatchUI', () => {
  let elements: Record<string, MockElement>;

  beforeEach(() => {
    elements = {
      over: new MockElement(),
      overcard1: new MockElement(),
      overcard2: new MockElement(),
    };

    (globalThis as any).document = {
      getElementById: (id: string) => elements[id] || null,
      querySelectorAll: (_sel: string) => [],
    };
  });

  it('renders Score in Cyan for Solo mode', () => {
    const game = createGame();
    game.twoPlayer = false;
    game.aiOn = false;
    game.players[0].score = 150;

    endMatchUI(game, () => {});

    expect(elements.overcard1.innerHTML).toContain(`<h2 style="color:${P_COLOR[0]}">Score</h2>`);
    expect(elements.overcard2.hasAttribute('hidden')).toBe(true);
  });

  it('renders You Won for P1 and You Lost for P2 when P1 wins in 2P mode', () => {
    const game = createGame();
    game.twoPlayer = true;
    game.aiOn = false;
    game.players[0].score = 200;
    game.players[1].score = 100;

    endMatchUI(game, () => {});

    expect(elements.overcard1.innerHTML).toContain(`<h2 style="color:${P_COLOR[0]}">You Won</h2>`);
    expect(elements.overcard2.innerHTML).toContain(`<h2 style="color:${P_COLOR[1]}">You Lost</h2>`);
    expect(elements.overcard2.hasAttribute('hidden')).toBe(false);
  });

  it('renders You Lost for P1 and You Won for P2 when P2 wins in 2P mode', () => {
    const game = createGame();
    game.twoPlayer = true;
    game.aiOn = false;
    game.players[0].score = 50;
    game.players[1].score = 120;

    endMatchUI(game, () => {});

    expect(elements.overcard1.innerHTML).toContain(`<h2 style="color:${P_COLOR[0]}">You Lost</h2>`);
    expect(elements.overcard2.innerHTML).toContain(`<h2 style="color:${P_COLOR[1]}">You Won</h2>`);
  });

  it('renders Draw header when scores are equal in 2P mode', () => {
    const game = createGame();
    game.twoPlayer = true;
    game.aiOn = false;
    game.players[0].score = 100;
    game.players[1].score = 100;

    endMatchUI(game, () => {});

    expect(elements.overcard1.innerHTML).toContain(`<h2 style="color:${P_COLOR[0]}">Draw</h2>`);
    expect(elements.overcard2.innerHTML).toContain(`<h2 style="color:${P_COLOR[1]}">Draw</h2>`);
  });

  it('renders You Lost for P1 when AI wins in vs AI mode and hides card2', () => {
    const game = createGame();
    game.twoPlayer = true;
    game.aiOn = true;
    game.players[0].score = 40;
    game.players[1].score = 90;

    endMatchUI(game, () => {});

    expect(elements.overcard1.innerHTML).toContain(`<h2 style="color:${P_COLOR[0]}">You Lost</h2>`);
    expect(elements.overcard2.hasAttribute('hidden')).toBe(true);
  });

  it('takes a headline and lines from the caller, on player 1\'s card only', () => {
    const game = createGame();
    game.twoPlayer = false;
    game.aiOn = false;
    game.players[0].score = 500;

    endMatchUI(game, () => {}, { title: 'New highest score', lines: ['Normal · previous <420>'] });

    expect(elements.overcard1.innerHTML).toContain('>New highest score</h2>');
    expect(elements.overcard1.innerHTML).not.toContain('>Score</h2>');
    // Plain text in, escaped out.
    expect(elements.overcard1.innerHTML).toContain('<p class="result-note">Normal · previous &lt;420&gt;</p>');
  });
});
