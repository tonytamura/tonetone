import { describe, it, expect, afterEach } from 'vitest';
import { canOfferFullscreen, detectInstalledWebApp } from '../../src/ui/Platform';

/** A window that reports `display-mode` as `mode`, optionally inside a frame. */
function stubWindow(mode: 'fullscreen' | 'browser', framed: boolean) {
  const self = {};
  (globalThis as any).window = { self, top: framed ? {} : self };
  (globalThis as any).document = { fullscreenElement: null };
  (globalThis as any).matchMedia = (q: string) => ({ matches: mode === 'fullscreen' && q.includes('display-mode: fullscreen') });
}

describe('where the game is running', () => {
  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).matchMedia;
  });

  it('takes a full screen window opened from the home screen for the installed website', () => {
    stubWindow('fullscreen', false);
    expect(detectInstalledWebApp()).toBe(true);
  });

  it('is a plain tab otherwise', () => {
    stubWindow('browser', false);
    expect(detectInstalledWebApp()).toBe(false);
  });

  it('never takes a frame for the installed website, even one another site has put full screen', () => {
    // itch.io's "launch in fullscreen": the frame matches display-mode fullscreen.
    stubWindow('fullscreen', true);
    expect(detectInstalledWebApp()).toBe(false);
  });

  it('offers its own full screen button in a tab of its own, never in a frame on another site', () => {
    stubWindow('browser', false);
    expect(canOfferFullscreen()).toBe(true);
    stubWindow('browser', true); // itch.io
    expect(canOfferFullscreen()).toBe(false);
  });
});
