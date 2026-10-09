import { describe, it, expect } from 'vitest';
import { precacheList, serviceWorker } from '../../scripts/web-layout';

describe('the web layout', () => {
  it('keeps the pages under the URLs Vercel serves them at, and every other file as it is', () => {
    const list = precacheList(['/index.html', '/play/index.html', '/privacy.html', '/assets/index-abc.js', '/og.png', '/sw.js']);
    expect(list).toEqual(['/', '/play', '/privacy', '/assets/index-abc.js', '/og.png']);
  });

  it('never keeps the worker itself, which the browser must fetch fresh to see a new version', () => {
    expect(precacheList(['/sw.js', '/a.css'])).not.toContain('/sw.js');
  });

  it('writes a worker for this version and these files, that leaves analytics to the network', () => {
    const js = serviceWorker('v123', ['/', '/play']);
    expect(js).toContain("const CACHE = 'toneboom-v123';");
    expect(js).toContain('const PRECACHE = ["/","/play"];');
    expect(js).toContain("startsWith('/_vercel/')");
    // Valid JavaScript.
    expect(() => new Function(js)).not.toThrow();
  });
});
