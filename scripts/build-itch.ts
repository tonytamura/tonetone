/**
 * Package the game for itch.io, after `vite build --base ./ --outDir dist-itch`:
 *
 *   npm run build:itch      → store/itch/tone-boom-<version>-web.zip
 *
 * itch.io serves an HTML5 game from a subfolder of its own CDN, inside an
 * iframe on the game's page, so the build uses relative paths (`--base ./`)
 * rather than the website's `/assets/...`. Only the game goes in: the landing
 * page, the privacy page, the install manifest and the share images belong to
 * toneboom.vercel.app, and the offline worker does not register inside an
 * iframe (src/ui/Offline.ts). No analytics either: that is added on Vercel only.
 *
 * Upload the zip as an HTML file ("This file will be played in the browser").
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

const OUT = 'dist-itch';
const version: string = JSON.parse(readFileSync('package.json', 'utf8')).version;

for (const f of ['home.html', 'privacy.html', 'manifest.webmanifest', 'og.png', 'home-shot.webp', 'icon-maskable-512.png']) {
  rmSync(join(OUT, f), { force: true });
}
// The landing page's own script and sheet, which only home.html loaded.
for (const f of readdirSync(join(OUT, 'assets'))) if (f.startsWith('home-')) rmSync(join(OUT, 'assets', f));
const index = join(OUT, 'index.html');
writeFileSync(index, readFileSync(index, 'utf8').replace(/\s*<link rel="manifest"[^>]*>/, ''));

mkdirSync('store/itch', { recursive: true });
const zip = join('store', 'itch', `tone-boom-${version}-web.zip`);
if (existsSync(zip)) rmSync(zip);
// From inside the folder, so index.html sits at the zip's root, as itch.io requires.
execFileSync('zip', ['-r', '-q', '-X', join('..', zip), '.'], { cwd: OUT });
console.log(`itch.io package: ${zip}`);
