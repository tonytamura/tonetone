/**
 * The game's words, in the player's language.
 *
 * English is the source: `en.ts` holds every string the player can read, and it
 * ships inside the main bundle, so the game can always speak. Every other
 * language is a file in `locales/`, typed as the same set of keys — a missing or
 * misspelt key is a compile error — and loaded only when chosen, so eleven
 * languages do not make every player download all twelve.
 *
 * The language is the one the player picked on the menu's flag button, kept on
 * the device; failing that, the device's own language when the game has it; and
 * failing that, English.
 *
 * Words that stay the same in every language (the glossary): Tone Boom, BOOM!,
 * AI1, AI2, AI3, AGI, P1 and P2. They are either names or sounds, and the
 * translations keep them as they are.
 *
 * Nothing here touches the simulation. The harness never sets a language, so
 * everything it prints is English.
 */
import { EN } from './en';
import { KeyValueStore, deviceStore } from '../ui/Progress';

export type MessageKey = keyof typeof EN;
/** A language's words: every key English has, no more. */
export type Messages = Record<MessageKey, string>;

export const LANGUAGE_KEY = 'toneboom.language';

export interface LanguageDef {
  id: LangId;
  /** Its own name for itself, which is how the picker lists it. */
  name: string;
}

export const LANGUAGES = [
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Español' },
  { id: 'pt', name: 'Português' },
  { id: 'fr', name: 'Français' },
  { id: 'de', name: 'Deutsch' },
  { id: 'it', name: 'Italiano' },
  // "Indonesia", as the phone's own settings list it: "Bahasa Indonesia" ran
  // out of its button in the two-column picker, and "Bahasa" alone only means "language".
  { id: 'id', name: 'Indonesia' },
  { id: 'tr', name: 'Türkçe' },
  { id: 'vi', name: 'Tiếng Việt' },
  { id: 'ru', name: 'Русский' },
  { id: 'ja', name: '日本語' },
  { id: 'ko', name: '한국어' },
] as const;

export type LangId = (typeof LANGUAGES)[number]['id'];

export function isLangId(id: unknown): id is LangId {
  return typeof id === 'string' && LANGUAGES.some(l => l.id === id);
}

// Every other language, as its own chunk, fetched when it is first chosen.
const LOADERS = import.meta.glob<{ default: Messages }>('./locales/*.ts');

let lang: LangId = 'en';
let words: Messages = EN;
const listeners: (() => void)[] = [];

/** The language in force. */
export function language(): LangId {
  return lang;
}

/**
 * The words for `key`, with each `{name}` replaced from `params`. A key the
 * current language lacks falls back to English, which only a stale build could
 * produce, since the types forbid it.
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let s = words[key] ?? EN[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
  return s;
}

/** A `|`-separated list of words, such as the pops that float over the results. */
export function tList(key: MessageKey): string[] {
  return t(key).split('|').map(w => w.trim()).filter(Boolean);
}

/** Called after every change of language, to redraw whatever is on screen. */
export function onLanguageChange(fn: () => void): void {
  listeners.push(fn);
}

/**
 * The best of the game's languages for a device that prefers `prefs`, in
 * order, or English if it has none of them. Only the language counts, not the
 * region: pt-PT reads the Brazilian translation, es-ES the Latin American one.
 */
export function detectLanguage(prefs: readonly string[] | undefined): LangId {
  for (const p of prefs ?? []) {
    let base = String(p).toLowerCase().split(/[-_]/)[0];
    if (base === 'in') base = 'id'; // the old code for Indonesian, still reported by some Android versions
    if (isLangId(base)) return base;
  }
  return 'en';
}

/** The language this device chose on the flag button, if it ever did. */
export function savedLanguage(store: KeyValueStore | null = deviceStore()): LangId | null {
  try {
    const raw = store?.getItem(LANGUAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && p.v === 1 && isLangId(p.lang) ? p.lang : null;
  } catch {
    return null;
  }
}

export function saveLanguage(id: LangId, store: KeyValueStore | null = deviceStore()): void {
  try {
    store?.setItem(LANGUAGE_KEY, JSON.stringify({ v: 1, lang: id }));
  } catch {
    // The choice lasts until the page closes; the game carries on.
  }
}

/** The language to start in: the saved choice, else the device's, else English. */
export function startingLanguage(
  store: KeyValueStore | null = deviceStore(),
  prefs: readonly string[] | undefined = typeof navigator !== 'undefined' ? navigator.languages : undefined,
): LangId {
  return savedLanguage(store) ?? detectLanguage(prefs);
}

async function load(id: LangId): Promise<Messages> {
  if (id === 'en') return EN;
  const loader = LOADERS[`./locales/${id}.ts`];
  if (!loader) return EN;
  return (await loader()).default;
}

/**
 * Switch to `id`: fetch its words, put them in force, mark the page with its
 * language (so the browser picks fitting fonts and casing, such as Turkish
 * dotted İ), relabel the markup and tell every listener. `save` remembers the
 * choice on this device; the first language at start-up is not a choice.
 */
export async function setLanguage(id: LangId, opts: { save?: boolean } = {}): Promise<void> {
  let next: Messages;
  try {
    next = await load(id);
  } catch {
    // A chunk that failed to load leaves the game in the language it had.
    return;
  }
  lang = id;
  words = next;
  if (opts.save) saveLanguage(id);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = id;
    translateDom(document);
  }
  for (const fn of listeners) fn();
}

/**
 * Relabel the markup: `data-i18n` sets an element's text (with `data-i18n-n`
 * as its `{n}`), `data-i18n-html` its
 * markup (for the few strings with bold words in them; the words are ours, not
 * the player's), and `data-i18n-aria` its accessible name and tooltip.
 */
export function translateDom(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    // `data-i18n-n` fills `{n}`, as in "Custom {n}".
    const n = el.dataset.i18nN;
    el.textContent = t(el.dataset.i18n as MessageKey, n === undefined ? undefined : { n });
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-html]')) {
    el.innerHTML = t(el.dataset.i18nHtml as MessageKey);
  }
  // `data-i18n-alt` an image's description.
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-alt]')) {
    el.setAttribute('alt', t(el.dataset.i18nAlt as MessageKey));
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    // The name also shows as a tooltip, which is how a mouse finds out what an
    // icon-only button does.
    const name = t(el.dataset.i18nAria as MessageKey);
    el.setAttribute('aria-label', name);
    el.setAttribute('title', name);
  }
}
