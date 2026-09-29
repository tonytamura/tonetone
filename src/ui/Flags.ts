/**
 * A flag for each of the game's languages, drawn as inline SVG.
 *
 * Emoji flags are not an option: Windows draws them as two letters, and the
 * flag of England — the one English uses here, as asked, rather than the
 * Union Jack or the United States — is a tag sequence many Android versions
 * cannot draw at all. These are simplified to read at 24 pixels wide: the
 * emblems are shapes, not artwork.
 *
 * One country stands for each language: England for English, Mexico for the
 * Latin American Spanish, Brazil for Brazilian Portuguese.
 */
import { LangId } from '../i18n/I18n';

/** A five-pointed star's outline, centred on (cx, cy). */
function star(cx: number, cy: number, outer: number, inner = outer * 0.382, turn = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((turn + i * 36) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

const vertical = (a: string, b: string, c: string) =>
  `<rect width="10" height="20" fill="${a}"/><rect x="10" width="10" height="20" fill="${b}"/><rect x="20" width="10" height="20" fill="${c}"/>`;
const horizontal = (a: string, b: string, c: string) =>
  `<rect width="30" height="6.67" fill="${a}"/><rect y="6.67" width="30" height="6.66" fill="${b}"/><rect y="13.33" width="30" height="6.67" fill="${c}"/>`;

/** Three short bars, a gap in the middle of each where `broken` says so: one of Korea's trigrams. */
function trigram(cx: number, cy: number, deg: number, broken: [boolean, boolean, boolean]): string {
  const bars = broken.map((b, i) => {
    const y = (i - 1) * 1.1;
    return b
      ? `<rect x="-1.8" y="${y - 0.35}" width="1.5" height="0.7"/><rect x="0.3" y="${y - 0.35}" width="1.5" height="0.7"/>`
      : `<rect x="-1.8" y="${y - 0.35}" width="3.6" height="0.7"/>`;
  });
  return `<g transform="translate(${cx} ${cy}) rotate(${deg})" fill="#000">${bars.join('')}</g>`;
}

const FLAGS: Record<LangId, string> = {
  // England: the cross of St George.
  en: '<rect width="30" height="20" fill="#fff"/><rect x="13" width="4" height="20" fill="#CE1124"/><rect y="8" width="30" height="4" fill="#CE1124"/>',
  // Mexico, the emblem as a disc.
  es: vertical('#006847', '#fff', '#CE1126') + '<circle cx="15" cy="10" r="2.6" fill="#8C6A3F"/><circle cx="15" cy="10" r="2.6" fill="none" stroke="#3E7A3A" stroke-width="0.6"/>',
  // Brazil: the rhombus, the globe and its band.
  pt: '<rect width="30" height="20" fill="#009C3B"/><polygon points="15,2 28,10 15,18 2,10" fill="#FFDF00"/>' +
    '<circle cx="15" cy="10" r="4.6" fill="#002776"/><path d="M10.5 9.2 Q15 7.6 19.6 10.6" stroke="#fff" stroke-width="0.8" fill="none"/>',
  fr: vertical('#0055A4', '#fff', '#EF4135'),
  de: horizontal('#000', '#DD0000', '#FFCE00'),
  it: vertical('#009246', '#fff', '#CE2B37'),
  id: '<rect width="30" height="10" fill="#CE1126"/><rect y="10" width="30" height="10" fill="#fff"/>',
  // Turkey: the crescent and star.
  tr: '<rect width="30" height="20" fill="#E30A17"/><circle cx="11.5" cy="10" r="5" fill="#fff"/><circle cx="12.75" cy="10" r="4" fill="#E30A17"/>' +
    `<polygon points="${star(17.6, 10, 2.3, 0.9, 180)}" fill="#fff"/>`,
  vi: `<rect width="30" height="20" fill="#DA251D"/><polygon points="${star(15, 10.4, 6)}" fill="#FFFF00"/>`,
  ru: horizontal('#fff', '#0039A6', '#D52B1E'),
  ja: '<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#BC002D"/>',
  // South Korea: the taegeuk and the four trigrams.
  ko: '<rect width="30" height="20" fill="#fff"/>' +
    '<g transform="rotate(33.7 15 10)"><path d="M10 10 A5 5 0 0 1 20 10 Z" fill="#CD2E3A"/><path d="M10 10 A5 5 0 0 0 20 10 Z" fill="#0047A0"/>' +
    '<circle cx="12.5" cy="10" r="2.5" fill="#CD2E3A"/><circle cx="17.5" cy="10" r="2.5" fill="#0047A0"/></g>' +
    trigram(6.2, 4.2, -56.3, [false, false, false]) + trigram(23.8, 15.8, -56.3, [true, true, true]) +
    trigram(23.8, 4.2, 56.3, [false, true, false]) + trigram(6.2, 15.8, 56.3, [true, false, true]),
};

/** The flag for `id` as an `<svg>` element's markup, 3:2, with a thin frame so white flags read on dark buttons. */
export function flagSvg(id: LangId): string {
  return `<svg class="flag" viewBox="0 0 30 20" aria-hidden="true" focusable="false">${FLAGS[id]}` +
    '<rect width="30" height="20" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="0.6"/></svg>';
}
