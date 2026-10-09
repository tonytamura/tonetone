/**
 * The page's height, measured by script and kept in the CSS variable `--app-h`,
 * which the page, the menu and the Options panel are sized by (index.css).
 *
 * They used `100dvh`, and Chrome on Android got it wrong when it opened the
 * installed game full screen from a link (from the itch.io page, for one): it
 * kept the height from before the system bars went away, so the menu's icons
 * sat half below the screen until something resized the page, such as
 * swiping the navigation bar in. `innerHeight` is read again on every change
 * the browser reports and, because that launch reported none, a few times in
 * the first seconds as well. A change is passed on as a `resize`, so the
 * canvases follow.
 */
let last = 0;

function measure(announce: boolean) {
  const h = window.innerHeight;
  if (!h || h === last) return;
  last = h;
  document.documentElement.style.setProperty('--app-h', h + 'px');
  if (announce) window.dispatchEvent(new Event('resize'));
}

export function trackViewportHeight(): void {
  if (typeof window === 'undefined') return;
  measure(false);
  const onChange = () => measure(false);
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', () => setTimeout(() => measure(true), 60));
  window.addEventListener('pageshow', () => measure(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) measure(true); });
  document.addEventListener('fullscreenchange', () => measure(true));
  window.visualViewport?.addEventListener('resize', () => measure(true));
  for (const ms of [50, 250, 1000, 2500]) setTimeout(() => measure(true), ms);
}
