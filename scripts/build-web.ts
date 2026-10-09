/**
 * Lay out `dist` for the web deploy, after `vite build`:
 *
 * - the landing page (home.html) becomes `/`, and the game (index.html) moves
 *   to `/play`. The build itself keeps the game at index.html because that is
 *   what the Android and iOS apps open;
 * - on Vercel, the Web Analytics script goes into every page: page views,
 *   without cookies, counted in the Vercel dashboard. Never in the apps, whose
 *   build does not run this;
 * - `sw.js`, the service worker that makes the site work offline, is written
 *   with the list of every file to keep (src/ui/Offline.ts registers it).
 *
 *   npm run build:web      (Vercel's build command, vercel.json)
 */
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { precacheList, serviceWorker, sitePaths } from './web-layout';

const DIST = 'dist';
const ANALYTICS = '<script defer src="/_vercel/insights/script.js"></script>';

function main() {
  mkdirSync(join(DIST, 'play'), { recursive: true });
  renameSync(join(DIST, 'index.html'), join(DIST, 'play', 'index.html'));
  renameSync(join(DIST, 'home.html'), join(DIST, 'index.html'));

  const paths = sitePaths(DIST);
  if (process.env.VERCEL === '1') {
    for (const p of paths.filter(p => p.endsWith('.html'))) {
      const file = join(DIST, p);
      writeFileSync(file, readFileSync(file, 'utf8').replace('</head>', `  ${ANALYTICS}\n</head>`));
    }
  }

  // The version changes whenever any file does, so a new deploy replaces the
  // kept copies and an unchanged one keeps them.
  const precache = precacheList(paths);
  const hash = createHash('sha256');
  for (const p of paths) hash.update(p).update(readFileSync(join(DIST, p)));
  const version = hash.digest('hex').slice(0, 12);
  writeFileSync(join(DIST, 'sw.js'), serviceWorker(version, precache));
  console.log(`web layout: / landing, /play game, ${precache.length} files kept offline (version ${version})`);
}

main();
