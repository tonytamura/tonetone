import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CREDITS, LICENSES } from '../../src/ui/Credits';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('credits', () => {
  it('credit the author as asked', () => {
    expect(CREDITS.by).toContain('Tony M. T. L.');
  });

  it('show the version package.json ships', () => {
    const { version } = JSON.parse(read('package.json'));
    expect(CREDITS.footer).toContain(`v${version}`);
  });
});

describe('licences', () => {
  it('carry every runtime dependency', () => {
    // Everything under `dependencies` ships inside the app. Each needs its
    // licence on the Help screen; add it to LICENSES before adding the package.
    const deps = Object.keys(JSON.parse(read('package.json')).dependencies);
    const covered = new Set(LICENSES.flatMap(l => l.packages));
    for (const d of deps) expect(covered.has(d), `${d} has no licence in src/ui/Credits.ts`).toBe(true);
  });

  it('are the full texts, not placeholders', () => {
    for (const l of LICENSES) {
      expect(l.text.length, l.name).toBeGreaterThan(900);
      expect(l.text, l.name).toMatch(/SIL OPEN FONT LICENSE|Permission is hereby granted/);
    }
  });
});

describe('typefaces ship with the game', () => {
  it('load no font from the network', () => {
    expect(read('index.html')).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(read('index.css')).not.toMatch(/https?:\/\/[^)]*\.woff2?/);
  });

  it('point every @font-face at a file that exists', () => {
    const urls = [...read('index.css').matchAll(/@font-face\s*\{[^}]*url\('([^']+)'\)/g)].map(m => m[1]);
    expect(urls.length).toBe(4);
    for (const u of urls) expect(existsSync(resolve(root, u)), u).toBe(true);
  });

  it('declare both families the canvas and the CSS ask for', () => {
    const css = read('index.css');
    for (const fam of ['Outfit', 'Montserrat']) expect(css).toMatch(new RegExp(`font-family: '${fam}'`));
  });
});
