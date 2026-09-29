import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initMenuScreen, showMenu, hideMenu, isMenuVisible } from '../../src/ui/menu/MenuScreen';
import { computeMenuLayout } from '../../src/ui/menu/MenuLayout';
import { MAX_MENU_VOICES, playBinauralClick, resetUiSoundsForTesting, setClickLockMs } from '../../src/audio/UiSounds';
import { AudioStore } from '../../src/audio/SynthEngine';
import type { PlayMode } from '../../src/game/GameState';
import { isNativeApp } from '../../src/ui/Platform';

// Where the game runs: a browser unless a test says it is the Android or iOS app.
vi.mock('../../src/ui/Platform', () => ({ isNativeApp: vi.fn(() => false) }));

/**
 * A 2D context that accepts anything drawn on it.
 *
 * The menu draws a logo, a backdrop and a crowd of drifting balls before it gets
 * to the buttons, so a mock listing the calls it makes would have to be kept in
 * step with three files of artwork. Unknown methods answer as no-ops and
 * properties keep whatever is assigned to them, which is all a test that cares
 * about input needs — it has to be able to run a frame, not to check the paint.
 */
function fakeContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const target: Record<string | symbol, any> = {
    measureText: () => ({ width: 100 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    canvas: { width: 1024, height: 768 },
  };
  return new Proxy(target, {
    get(t, key) {
      if (!(key in t)) t[key] = () => {};
      return t[key];
    },
    set(t, key, value) {
      t[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

class MockElement {
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  textContent: string = '';
  classList = {
    classes: new Set<string>(),
    add: (c: string) => { this.classList.classes.add(c); },
    remove: (c: string) => { this.classList.classes.delete(c); },
    contains: (c: string) => this.classList.classes.has(c),
    toggle: (c: string, on?: boolean) => {
      const want = on ?? !this.classList.classes.has(c);
      if (want) this.classList.classes.add(c); else this.classList.classes.delete(c);
      return want;
    },
  };

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
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1024, height: 768 };
  }
  getContext(_type: string) {
    return fakeContext();
  }
}

describe('MenuScreen', () => {
  let menuContainer: MockElement;
  let canvasEl: MockElement;
  let audioBtnEl: MockElement;
  let fsBtnEl: MockElement;
  /** Every listener `initMenuScreen` put on the window, by event name. */
  let listeners: Record<string, Function[]>;
  /** Frames the menu has asked for and not yet been given. */
  let frames: FrameRequestCallback[];

  /** Deliver one animation frame, so the menu draws exactly once. */
  function drawOneFrame() {
    const next = frames.shift();
    if (next) next(0);
  }

  function fire(type: string, event: any) {
    for (const fn of listeners[type] || []) fn(event);
  }

  beforeEach(() => {
    menuContainer = new MockElement();
    canvasEl = new MockElement();
    audioBtnEl = new MockElement();
    fsBtnEl = new MockElement();
    listeners = {};
    frames = [];
    // The menu asks the global, not the window. Holding the callbacks here
    // instead of running them on a timer is what lets a test draw a frame when
    // it means to and never in the middle of an assertion.
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    };
    (globalThis as any).cancelAnimationFrame = () => { frames.length = 0; };

    (globalThis as any).document = {
      documentElement: {
        requestFullscreen: vi.fn(),
      },
      getElementById: (id: string) => {
        if (id === 'menu-screen') return menuContainer;
        if (id === 'gameMenu') return canvasEl;
        if (id === 'audioToggle') return audioBtnEl;
        if (id === 'fsToggle') return fsBtnEl;
        return null;
      },
      addEventListener: () => {},
      // The backdrop bakes its glows into offscreen canvases the first time it
      // draws, so a frame cannot run without one.
      createElement: () => new MockElement(),
    };

    (globalThis as any).window = {
      innerWidth: 1024,
      innerHeight: 768,
      devicePixelRatio: 1,
      addEventListener: (type: string, fn: Function) => {
        (listeners[type] ||= []).push(fn);
      },
      requestAnimationFrame: (cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
      },
      cancelAnimationFrame: () => { frames.length = 0; },
    };
  });

  it('initializes and toggles menu visibility correctly', () => {
    let selectedMode: PlayMode | null = null;
    initMenuScreen((mode) => {
      selectedMode = mode;
    });

    showMenu();
    expect(isMenuVisible()).toBe(true);
    expect(menuContainer.hasAttribute('hidden')).toBe(false);

    hideMenu();
    expect(isMenuVisible()).toBe(false);
    expect(menuContainer.hasAttribute('hidden')).toBe(true);
  });

  it('refreshes the sound and full screen icons each time the menu is shown', () => {
    initMenuScreen(() => {});

    AudioStore.soundOn = false;
    showMenu();
    // Off: the "no" sign over the speaker, and the toggle says it is not pressed.
    expect(audioBtnEl.classList.contains('off')).toBe(true);
    expect(audioBtnEl.attributes['aria-pressed']).toBe('false');
    // Not full screen: the button is not lit.
    expect(fsBtnEl.classList.contains('active')).toBe(false);
    expect(fsBtnEl.attributes['aria-pressed']).toBe('false');

    hideMenu();
    AudioStore.soundOn = true;
    showMenu();
    expect(audioBtnEl.classList.contains('off')).toBe(false);
    expect(audioBtnEl.attributes['aria-pressed']).toBe('true');

    hideMenu();
  });

  it('hides full screen button if requestFullscreen is not supported', () => {
    (globalThis as any).document.documentElement = {};
    initMenuScreen(() => {});
    showMenu();
    expect(fsBtnEl.hasAttribute('hidden')).toBe(true);
    hideMenu();
  });

  it('hides the full screen button in the Android and iOS apps, which are full screen already', () => {
    vi.mocked(isNativeApp).mockReturnValue(true);
    initMenuScreen(() => {});
    showMenu();
    expect(fsBtnEl.hasAttribute('hidden')).toBe(true);
    hideMenu();
    vi.mocked(isNativeApp).mockReturnValue(false);
  });

  it('accepts onOptions callback on initMenuScreen', () => {
    let optionsOpened = false;
    initMenuScreen(() => {}, () => {
      optionsOpened = true;
    });
    expect(optionsOpened).toBe(false);
  });

  it('computes 4 distinct button layout rectangles with non-overlapping Y bounds', () => {
    const layout = computeMenuLayout(1024, 768, canvasEl.getContext('2d') as any);
    expect(layout.buttons.length).toBe(4);
    expect(layout.buttons[0].text).toBe('Solo');
    expect(layout.buttons[1].text).toBe('vs AI');
    expect(layout.buttons[2].text).toBe('vs Friend');
    expect(layout.buttons[3].text).toBe('Options');

    for (let i = 0; i < layout.buttons.length - 1; i++) {
      const current = layout.buttons[i];
      const next = layout.buttons[i + 1];
      expect(next.y).toBeGreaterThan(current.y + current.height);
    }
  });

  /**
   * The menu's input, which is two different stories.
   *
   * A mouse hovers and chooses on the way down. A finger cannot hover, so it
   * highlights silently while it is down and chooses on the way up, over
   * whichever button it lifts over — which means a finger that lands on the
   * wrong button can slide to the right one, and a finger that lands on the
   * menu by mistake can slide off and choose nothing.
   */
  describe('pointer input', () => {
    /** Counts every voice the real click synth starts, so a test can tell
     *  silence from a sound without reaching inside the synth. */
    let oscillators: number;
    let filterFreqs: number[];

    function silenceCount() {
      oscillators = 0;
      filterFreqs = [];
    }

    function centreOf(index: number) {
      const layout = computeMenuLayout(1024, 768, fakeContext());
      const b = layout.buttons[index];
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }

    function touch(type: string, at: { x: number; y: number }) {
      fire(type, { clientX: at.x, clientY: at.y, pointerType: 'touch' });
    }

    function mouse(type: string, at: { x: number; y: number }) {
      fire(type, { clientX: at.x, clientY: at.y, pointerType: 'mouse' });
    }

    let clock = 100000;
    /** Step past the input debounce and the hover quiet window. */
    function tick(ms = 500) {
      clock += ms;
      vi.spyOn(performance, 'now').mockReturnValue(clock);
    }

    beforeEach(() => {
      resetUiSoundsForTesting();
      AudioStore.soundOn = true;
      silenceCount();
      const gain = () => ({
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      });
      AudioStore.actx = {
        currentTime: 10,
        state: 'running',
        resume: vi.fn(),
        createBiquadFilter: () => ({
          type: 'lowpass',
          frequency: {
            set value(v: number) { filterFreqs.push(v); },
            setValueAtTime: vi.fn(),
          },
          Q: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          disconnect: vi.fn(),
        }),
        createGain: gain,
        createOscillator: () => {
          oscillators++;
          return {
            type: 'sine',
            frequency: { value: 440, setValueAtTime: vi.fn() },
            start: vi.fn(),
            stop: vi.fn(),
            onended: null as any,
            connect: vi.fn(),
            disconnect: vi.fn(),
          };
        },
        createStereoPanner: () => ({ pan: { setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }),
        destination: {},
      } as any;
      AudioStore.master = null as any;
      tick();
    });

    it('does not choose the button a finger lands on', () => {
      let chosen: PlayMode | null = null;
      initMenuScreen((mode) => { chosen = mode; });
      showMenu();

      touch('pointerdown', centreOf(0));

      expect(chosen).toBeNull();
      // Silent too: the select click belongs to the lift, not to the landing.
      expect(oscillators).toBe(0);

      touch('pointercancel', centreOf(0));
      hideMenu();
    });

    it('chooses the button the finger lifts over, not the one it landed on', async () => {
      let chosen: PlayMode | null = null;
      initMenuScreen((mode) => { chosen = mode; });
      showMenu();

      touch('pointerdown', centreOf(0));   // lands on Solo
      touch('pointermove', centreOf(2));   // slides down to 2 players
      expect(chosen).toBeNull();
      touch('pointerup', centreOf(2));

      // The press is held lit briefly before the screen changes.
      await new Promise((r) => setTimeout(r, 200));
      expect(chosen).toBe('duel');
      expect(oscillators).toBeGreaterThan(0); // the select click

      hideMenu();
      await new Promise((r) => setTimeout(r, 600)); // let the slide-out finish
    });

    it('chooses nothing, and says nothing, when the finger lifts off every button', async () => {
      let chosen: PlayMode | null = null;
      initMenuScreen((mode) => { chosen = mode; });
      showMenu();

      touch('pointerdown', centreOf(0));
      touch('pointermove', { x: 20, y: 20 });  // slid off the list
      touch('pointerup', { x: 20, y: 20 });

      await new Promise((r) => setTimeout(r, 200));
      expect(chosen).toBeNull();
      expect(oscillators).toBe(0);

      hideMenu();
    });

    it('still chooses on the way down for a mouse', async () => {
      let chosen: PlayMode | null = null;
      initMenuScreen((mode) => { chosen = mode; });
      showMenu();

      mouse('pointerdown', centreOf(1));

      await new Promise((r) => setTimeout(r, 200));
      expect(chosen).toBe('ai');

      hideMenu();
      await new Promise((r) => setTimeout(r, 600));
    });

    it('sounds when a mouse moves onto a button, and stays silent when a finger slides onto one', () => {
      initMenuScreen(() => {});
      showMenu();

      // A mouse arriving on a button: the hover voice, which the lowpass at
      // 650Hz identifies — every other click is filtered at 800.
      mouse('pointermove', centreOf(0));
      drawOneFrame();
      expect(oscillators).toBeGreaterThan(0);
      expect(filterFreqs).toContain(650);

      // The same move under a finger, which is only sliding: no voice at all.
      tick();
      silenceCount();
      touch('pointerdown', centreOf(1));
      touch('pointermove', centreOf(2));
      drawOneFrame();
      touch('pointermove', centreOf(3));
      drawOneFrame();
      expect(oscillators).toBe(0);

      touch('pointercancel', centreOf(3));
      hideMenu();
    });
  });

  describe('playBinauralClick Audio Management', () => {
    let createdNodes: any[];
    let createdGains: any[];
    let createdOscillators: any[];
    let mockCtx: any;

    beforeEach(() => {
      resetUiSoundsForTesting();
      // The click lock refuses a second click inside 180ms. These tests fire
      // clicks back to back on purpose, so they turn it off rather than relying
      // on production code noticing it is under test.
      setClickLockMs(0);
      createdNodes = [];
      createdGains = [];
      createdOscillators = [];
      AudioStore.soundOn = true;

      const trackNode = (n: any) => {
        createdNodes.push(n);
        return n;
      };

      mockCtx = {
        currentTime: 10.0,
        state: 'running',
        resume: vi.fn(),
        createBiquadFilter: vi.fn(() => trackNode({
          type: 'lowpass',
          frequency: { setValueAtTime: vi.fn() },
          Q: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          disconnect: vi.fn(),
        })),
        createGain: vi.fn(() => {
          const g = trackNode({
            gain: {
              value: 1,
              setValueAtTime: vi.fn(),
              linearRampToValueAtTime: vi.fn(),
              exponentialRampToValueAtTime: vi.fn(),
            },
            connect: vi.fn(),
            disconnect: vi.fn(),
          });
          createdGains.push(g);
          return g;
        }),
        createOscillator: vi.fn(() => {
          const osc = trackNode({
            type: 'sine',
            frequency: { value: 440, setValueAtTime: vi.fn() },
            start: vi.fn(),
            stop: vi.fn(),
            onended: null as any,
            connect: vi.fn(),
            disconnect: vi.fn(),
          });
          createdOscillators.push(osc);
          return osc;
        }),
        createStereoPanner: vi.fn(() => trackNode({
          pan: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          disconnect: vi.fn(),
        })),
        destination: {},
      };

      AudioStore.actx = mockCtx as any;
      AudioStore.master = mockCtx.destination as any;
    });

    it('does not create audio nodes when AudioStore.soundOn is false', () => {
      AudioStore.soundOn = false;
      playBinauralClick(261.63, 0.16, 0, 'select');
      expect(mockCtx.createOscillator).not.toHaveBeenCalled();
    });

    it('schedules smooth gain ramp up and zero-crossing decay to zero to prevent clicks', () => {
      playBinauralClick(261.63, 0.16, 0, 'select');

      expect(createdGains.length).toBeGreaterThan(0);
      createdGains.forEach(gNode => {
        expect(gNode.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, expect.any(Number));
        expect(gNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
      });
    });

    it('cleans up WebAudio nodes and invokes disconnect() on ended to prevent memory and audio leaks', () => {
      playBinauralClick(261.63, 0.16, 0, 'select');

      const masterNode = createdOscillators.find(n => typeof n.onended === 'function');
      expect(masterNode).toBeDefined();

      masterNode.onended();

      createdNodes.forEach(n => {
        expect(n.disconnect).toHaveBeenCalled();
      });
    });

    it('caps concurrent active binaural click voices to MAX_MENU_VOICES to prevent WebAudio thread overload', () => {
      mockCtx.currentTime = 1.0;
      let timestampCounter = 100;

      const invokeClick = () => {
        timestampCounter += 100;
        vi.spyOn(performance, 'now').mockReturnValue(timestampCounter);
        playBinauralClick(261.63, 0.16, 0, 'select');
      };

      for (let i = 0; i < 10; i++) {
        invokeClick();
      }

      const masterNodes = createdOscillators.filter(n => typeof n.onended === 'function');
      expect(masterNodes.length).toBeLessThanOrEqual(MAX_MENU_VOICES);
    });
  });
});
