/**
 * The credits at the foot of the Help screen, and the licences of what the
 * game ships that it did not write.
 *
 * Two of those have licences that ask for their notice to travel with the
 * app: Capacitor's MIT licence, and the SIL Open Font License of the two
 * typefaces embedded since 2026-09-28. Their texts are kept in
 * `src/assets/licenses` and shown in full behind "Open source licenses".
 * `tests/ui/Credits.test.ts` fails if a runtime dependency is added without
 * one.
 */
import { version } from '../../package.json';
import { t } from '../i18n/I18n';
import capacitorCore from '../assets/licenses/Capacitor-MIT.txt?raw';
import capacitorPlugins from '../assets/licenses/Capacitor-Plugins-MIT.txt?raw';
import montserrat from '../assets/licenses/Montserrat-OFL.txt?raw';
import outfit from '../assets/licenses/Outfit-OFL.txt?raw';

/** The credits' words, in the player's language. The names and the licences stay as they are. */
export function credits() {
  return {
    title: t('credits.title'),
    by: t('credits.by'),
    lines: [t('credits.sound'), t('credits.type'), t('credits.built')],
    licensesLabel: t('credits.licenses'),
    footer: `v${version} · © 2026 Tony M. T. L.`,
  };
}

export interface LicenseEntry {
  /** What it covers, as a reader would name it. */
  name: string;
  /** The npm packages it covers, if any; the test matches these against package.json. */
  packages: string[];
  text: string;
}

export const LICENSES: LicenseEntry[] = [
  { name: 'Montserrat (typeface)', packages: [], text: montserrat },
  { name: 'Outfit (typeface)', packages: [], text: outfit },
  { name: 'Capacitor', packages: ['@capacitor/core', '@capacitor/android', '@capacitor/ios'], text: capacitorCore },
  {
    name: 'Capacitor plugins: Haptics, Status Bar, Screen Orientation',
    packages: ['@capacitor/haptics', '@capacitor/status-bar', '@capacitor/screen-orientation'],
    text: capacitorPlugins,
  },
];

/** Fill the Help screen's credits section from `credits()` and `LICENSES`. */
export function fillCredits(root: HTMLElement | null) {
  if (!root) return;
  root.innerHTML = '';
  const add = (tag: string, cls: string, text: string, parent: HTMLElement = root) => {
    const e = document.createElement(tag);
    e.className = cls;
    e.textContent = text;
    parent.appendChild(e);
    return e;
  };
  const CREDITS = credits();
  add('div', 'help-credits-title', CREDITS.title);
  add('div', 'help-credits-by', CREDITS.by);
  for (const l of CREDITS.lines) add('div', 'help-credits-line', l);
  // A native disclosure: it opens and closes without script, and is read out
  // as one by screen readers.
  const details = document.createElement('details');
  details.className = 'help-licenses';
  add('summary', '', CREDITS.licensesLabel, details);
  for (const lic of LICENSES) {
    add('div', 'help-license-name', lic.name, details);
    add('pre', 'help-license-text', lic.text.trim(), details);
  }
  root.appendChild(details);
  add('div', 'help-credits-footer', CREDITS.footer);
}
