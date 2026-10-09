import { describe, it, expect, vi, afterEach } from 'vitest';

describe('the page height', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  it('is measured by script, and measured again after launch, when Chrome reported no change', async () => {
    vi.useFakeTimers();
    const vars: Record<string, string> = {};
    const resizes: number[] = [];
    const win: any = {
      innerHeight: 800,
      addEventListener: () => {},
      dispatchEvent: (e: Event) => { if (e.type === 'resize') resizes.push(win.innerHeight); },
    };
    (globalThis as any).window = win;
    (globalThis as any).document = {
      hidden: false,
      addEventListener: () => {},
      documentElement: { style: { setProperty: (k: string, v: string) => { vars[k] = v; } } },
    };
    vi.resetModules();
    const { trackViewportHeight } = await import('../../src/ui/ViewportHeight');
    trackViewportHeight();
    expect(vars['--app-h']).toBe('800px');
    expect(resizes).toEqual([]);

    // The full screen launch: the bars go, the height grows, and no event says so.
    win.innerHeight = 900;
    vi.advanceTimersByTime(300);
    expect(vars['--app-h']).toBe('900px');
    expect(resizes).toEqual([900]); // passed on once, so the canvases follow

    vi.advanceTimersByTime(3000);
    expect(resizes).toEqual([900]); // and not again while nothing changes
  });
});
