/**
 * The pieces of the web layout that can be tested without a build: which files
 * the offline worker keeps, under which URLs, and the worker itself. Used by
 * scripts/build-web.ts.
 */
import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/** Every file under `dir`, as a site path ("/assets/x.js"). */
export function sitePaths(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sitePaths(full, root));
    else out.push('/' + relative(root, full).split('\\').join('/'));
  }
  return out;
}

/**
 * What the worker keeps: the pages under their clean URLs (Vercel serves
 * play/index.html at /play and privacy.html at /privacy), and every other file
 * as it is. The worker itself is fetched fresh by the browser, never cached.
 */
export function precacheList(paths: string[]): string[] {
  const pages: string[] = [];
  const files: string[] = [];
  for (const p of paths) {
    if (p === '/sw.js') continue;
    if (p === '/index.html') pages.push('/');
    else if (p.endsWith('/index.html')) pages.push(p.slice(0, -'/index.html'.length));
    else if (p.endsWith('.html')) pages.push(p.slice(0, -'.html'.length));
    else files.push(p);
  }
  return [...pages.sort(), ...files.sort()];
}

export function serviceWorker(version: string, precache: string[]): string {
  return `// Written by scripts/build-web.ts; do not edit.
const CACHE = 'toneboom-${version}';
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('toneboom-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/_vercel/')) return;
  if (req.mode === 'navigate') {
    // Pages: the network first, so a new version shows as soon as it ships;
    // the kept copy when offline.
    const path = url.pathname.replace(/\\/$/, '') || '/';
    e.respondWith(fetch(req).catch(() =>
      caches.match(path).then(hit => hit || caches.match('/play'))));
    return;
  }
  // Everything else is named by its content hash or never changes: kept copy first.
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
`;
}
