import { describe, it, expect, afterEach } from 'vitest';
import {
  LANGUAGES, LANGUAGE_KEY, Messages, detectLanguage, language, saveLanguage, savedLanguage, setLanguage,
  startingLanguage, t, tList,
} from '../../src/i18n/I18n';
import { EN } from '../../src/i18n/en';
import { flagSvg } from '../../src/ui/Flags';
import { KeyValueStore } from '../../src/ui/Progress';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

const LOCALES = import.meta.glob<{ default: Messages }>('../../src/i18n/locales/*.ts', { eager: true });
const byId = (id: string) => LOCALES[`../../src/i18n/locales/${id}.ts`]?.default;

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

/** Words every language keeps as they are, and the keys whose English carries them. */
const GLOSSARY: [string, (keyof typeof EN)[]][] = [
  ['Tone Boom', ['offer.title']],
  ['BOOM!', ['menu.pops']],
  ['AGI', ['res.beatAgi', 'knob.ailevel.hint']],
  ['AI1', ['knob.ailevel.hint']],
  ['Tony M. T. L.', ['credits.by']],
  ['MIT License', ['credits.built']],
  ['SIL Open Font License', ['credits.type']],
];

describe('the language in force', () => {
  afterEach(() => setLanguage('en'));

  it('is English until another is chosen, and fills in {values}', () => {
    expect(language()).toBe('en');
    expect(t('ladder.best', { ai: 'AI2', score: 480 })).toBe('Best against AI2: 480');
    expect(tList('res.pops')).toContain('WINNER!');
  });

  it('switches every word when another language loads', async () => {
    await setLanguage('pt');
    expect(language()).toBe('pt');
    expect(t('menu.solo')).toBe(byId('pt')['menu.solo']);
    await setLanguage('en');
    expect(t('menu.solo')).toBe('Solo');
  });
});

describe('the starting language', () => {
  it('follows the device when the game has it, whatever the region', () => {
    expect(detectLanguage(['pt-BR', 'en-US'])).toBe('pt');
    expect(detectLanguage(['es-419'])).toBe('es');
    expect(detectLanguage(['de-AT'])).toBe('de');
    expect(detectLanguage(['ja'])).toBe('ja');
    expect(detectLanguage(['in-ID'])).toBe('id'); // the old Indonesian code some Androids still report
  });

  it('is English when the device speaks nothing the game has', () => {
    expect(detectLanguage(['zh-CN', 'ar'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
    expect(detectLanguage(undefined)).toBe('en');
  });

  it('prefers what the player chose on the flag button over the device', () => {
    const s = memoryStore();
    expect(startingLanguage(s, ['fr-FR'])).toBe('fr');
    saveLanguage('ko', s);
    expect(savedLanguage(s)).toBe('ko');
    expect(startingLanguage(s, ['fr-FR'])).toBe('ko');
  });

  it('ignores a corrupt or unknown saved choice', () => {
    const s = memoryStore();
    for (const raw of ['{bad', '{"v":1,"lang":"xx"}', '{"v":2,"lang":"fr"}']) {
      s.data.set(LANGUAGE_KEY, raw);
      expect(startingLanguage(s, ['it']), raw).toBe('it');
    }
  });
});

describe('every translation', () => {
  it('exists for every language but English, which is the source', () => {
    for (const { id } of LANGUAGES) {
      if (id === 'en') continue;
      expect(byId(id), `${id} has no translation`).toBeTruthy();
    }
  });

  for (const { id } of LANGUAGES.filter(l => l.id !== 'en')) {
    describe(id, () => {
      const m = () => byId(id) as Record<string, string>;

      it('has every key, and only those', () => {
        expect(Object.keys(m()).sort()).toEqual(Object.keys(EN).sort());
      });

      it('keeps every {value}, and leaves nothing untranslated by accident', () => {
        for (const [k, en] of Object.entries(EN)) {
          expect(placeholders(m()[k]), `${id} ${k}`).toBe(placeholders(en));
          expect(m()[k].trim().length, `${id} ${k} is empty`).toBeGreaterThan(0);
        }
      });

      it('keeps the pop words a list of short words', () => {
        for (const k of ['menu.pops', 'res.pops', 'res.agiPops'] as const) {
          const words = m()[k].split('|');
          expect(words.length, `${id} ${k}`).toBeGreaterThanOrEqual(3);
          for (const w of words) expect(w.trim().length, `${id} ${k}: "${w}"`).toBeLessThanOrEqual(14);
        }
      });

      it('keeps the glossary as it is', () => {
        for (const [word, keys] of GLOSSARY) {
          for (const k of keys) expect(m()[k], `${id} ${k} lost "${word}"`).toContain(word);
        }
      });

      it('keeps the bold words in the preset hint', () => {
        expect((m()['panel.presetHint'].match(/<b>/g) ?? []).length).toBe(3);
        expect((m()['panel.presetHint'].match(/<\/b>/g) ?? []).length).toBe(3);
      });
    });
  }
});

describe('flags', () => {
  it('draw one for every language', () => {
    for (const { id } of LANGUAGES) expect(flagSvg(id)).toMatch(/^<svg class="flag" viewBox="0 0 30 20"[^>]*>.+<\/svg>$/);
  });

  it('show the Union Jack for English', () => {
    // Its blue field and red crosses, not England's white field alone.
    expect(flagSvg('en')).toContain('#012169');
    expect(flagSvg('en')).toContain('#C8102E');
  });
});
