import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';

/**
 * The site's own address, for the share tags (`og:image` must be absolute).
 * Vercel exposes the production domain to the build; anywhere else, including
 * the native builds, the current Vercel address stands in.
 */
const SITE_URL = 'https://' + (process.env.VERCEL_PROJECT_PRODUCTION_URL || 'tonetone-six.vercel.app');

function siteUrl(): Plugin {
  return {
    name: 'tone-boom-site-url',
    // Before Vite reads the page's URLs: it decodes them, and "%SI" is not an escape.
    transformIndexHtml: { order: 'pre', handler: html => html.replaceAll('%SITE_URL%', SITE_URL) },
  };
}

export default defineConfig({
  root: './',
  plugins: [siteUrl()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Off: the web build is public and the apps ship the same files.
    sourcemap: false,
    rollupOptions: {
      // The game is index.html, which the Android and iOS apps open. home.html
      // is the web landing page; `npm run build:web` moves it to / and the game
      // to /play for the Vercel deploy (scripts/build-web.ts).
      input: { main: resolve(__dirname, 'index.html'), home: resolve(__dirname, 'home.html') },
    },
  },
  server: {
    port: 3000,
    host: true,
  },
});
