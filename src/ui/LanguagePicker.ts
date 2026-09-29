/**
 * The flag button on the main menu and the screen it opens.
 *
 * The button is the current language's flag and nothing else. It opens a card
 * shaped like Help's, with Close at the top and one button per language below
 * it — each a flag and the language's own name for itself, so a player who
 * cannot read the current language can still find theirs. Picking one switches
 * the whole game at once and remembers the choice on this device.
 */
import { LANGUAGES, LangId, language, onLanguageChange, setLanguage } from '../i18n/I18n';
import { flagSvg } from './Flags';
import { setHidden } from './Dom';
import { uiClick } from '../audio/UiSounds';

function el(id: string) {
  return document.getElementById(id);
}

export function setupLanguagePicker() {
  const btn = el('langBtn');
  const overlay = el('lang-overlay');
  const list = el('lang-list');

  const paintButton = () => {
    if (btn) btn.innerHTML = flagSvg(language());
  };

  const fillList = () => {
    if (!list) return;
    list.innerHTML = '';
    for (const l of LANGUAGES) {
      const b = document.createElement('button');
      b.className = 'confirm-btn secondary lang-choice';
      b.dataset.lang = l.id;
      b.setAttribute('lang', l.id);
      const current = l.id === language();
      b.classList.toggle('current', current);
      b.setAttribute('aria-pressed', String(current));
      b.innerHTML = flagSvg(l.id);
      const name = document.createElement('span');
      name.textContent = l.name;
      b.appendChild(name);
      list.appendChild(b);
    }
  };

  const close = () => setHidden(overlay, true);

  btn?.addEventListener('click', e => {
    e.stopPropagation();
    uiClick('confirm');
    fillList();
    setHidden(overlay, false);
  });
  el('lang-close')?.addEventListener('click', e => { e.stopPropagation(); uiClick('cancel'); close(); });
  list?.addEventListener('click', e => {
    const choice = (e.target as HTMLElement).closest('.lang-choice') as HTMLElement | null;
    if (!choice) return;
    e.stopPropagation();
    uiClick('confirm');
    void setLanguage(choice.dataset.lang as LangId, { save: true }).then(close);
  });
  // The menu listens on the window for its own taps; nothing on this screen
  // should reach it and choose a mode underneath.
  for (const type of ['pointerdown', 'pointerup'] as const) {
    overlay?.addEventListener(type, e => e.stopPropagation());
  }

  paintButton();
  onLanguageChange(() => { paintButton(); fillList(); });
}
