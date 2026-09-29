import { logoFont } from '../../graphics/Fonts';
import { MessageKey, t } from '../../i18n/I18n';

/**
 * Where the logo and the buttons go, for a given canvas size.
 *
 * Pure arithmetic over a width, a height and a context to measure text with —
 * it touches no module state, which is what lets `tests/ui/Menu.test.ts` assert
 * the layout at sizes no real screen has.
 */

export interface MenuItem {
  /** The words on the button, looked up in the player's language each frame. */
  key: MessageKey;
  action: string;
}

export const menuItems: MenuItem[] = [
  { key: 'menu.solo', action: 'solo' },
  { key: 'menu.vsAi', action: 'one_player' },
  { key: 'menu.vsFriend', action: 'two_player' },
  { key: 'menu.options', action: 'options' }
];

export interface ButtonRect {
  index: number;
  text: string;
  action: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

export interface MenuLayout {
  logoCenterY: number;
  effectiveFontSize: number;
  ballRadius: number;
  logoBottom: number;
  buttons: ButtonRect[];
}

export function computeMenuLayout(w: number, h: number, c: CanvasRenderingContext2D | null): MenuLayout {
  const isCompactHeight = h < 650;
  const logoBudget = isCompactHeight ? 0.96 : 1.22;
  const minSafeTop = isCompactHeight ? 70 : 100;
  const logoCenterY = Math.max(minSafeTop, Math.floor(h * (isCompactHeight ? 0.165 : 0.195)));

  const maxAllowedWidth = w * 0.92;
  const targetFontSize = Math.max(36, Math.min(130, Math.floor(w * 0.12 * logoBudget)));

  let effectiveFontSize = targetFontSize;
  let ballRadius = Math.max(12, Math.floor(targetFontSize * 0.39));

  if (c) {
    c.save();
    c.font = logoFont(targetFontSize);
    const tWidth = c.measureText('T').width;
    const neWidth = c.measureText('NE').width;
    const bWidth = c.measureText('B').width;
    const mWidth = c.measureText('M').width;
    c.restore();

    const speakerRadius = ballRadius;
    const letterSpacing = targetFontSize * 0.06;
    const word1Width = tWidth + letterSpacing + (speakerRadius * 2) + letterSpacing + neWidth;
    const ballSpacing = ballRadius * 2.12;
    const word2Width = bWidth + letterSpacing + ballRadius + ballSpacing + ballRadius + letterSpacing + mWidth;
    const wordGap = targetFontSize * 0.40;
    const totalLogoWidth = word1Width + wordGap + word2Width;

    if (totalLogoWidth > maxAllowedWidth) {
      const ratio = maxAllowedWidth / totalLogoWidth;
      effectiveFontSize = Math.max(26, Math.floor(targetFontSize * ratio));
      ballRadius = Math.max(10, Math.floor(effectiveFontSize * 0.39));
    }
  }

  const logoBottom = logoCenterY + ballRadius + 14;

  const numItems = menuItems.length;
  const availableHeight = Math.max(180, h - logoBottom);
  const rawItemH = Math.floor((availableHeight / (numItems + 1.2)));
  const itemH = Math.max(38, Math.min(50, rawItemH - 6));
  const itemGap = Math.max(10, Math.min(18, Math.floor((availableHeight - itemH * numItems) / (numItems + 1))));
  const totalMenuHeight = numItems * itemH + (numItems - 1) * itemGap;
  const itemSpacing = itemH + itemGap;

  // Position menu block higher up below logo (menu up a bit)
  const spaceBelowLogo = Math.max(0, h - logoBottom - totalMenuHeight);
  const centeredStartY = Math.floor(logoBottom + spaceBelowLogo * 0.32);
  const btnWidth = Math.min(w * 0.84, Math.max(260, Math.min(390, w * 0.38)));
  const fontSize = Math.max(14, Math.min(17, Math.floor(itemH * 0.38)));

  const buttons: ButtonRect[] = menuItems.map((item, index) => {
    const btnX = w / 2 - btnWidth / 2;
    const btnY = centeredStartY + index * itemSpacing;
    return {
      index,
      text: t(item.key),
      action: item.action,
      x: btnX,
      y: btnY,
      width: btnWidth,
      height: itemH,
      fontSize
    };
  });

  return {
    logoCenterY,
    effectiveFontSize,
    ballRadius,
    logoBottom,
    buttons
  };
}

/** Which button contains a point, or -1. */
export function buttonIndexAt(layout: MenuLayout, px: number, py: number): number {
  for (const btn of layout.buttons) {
    if (px >= btn.x && px <= btn.x + btn.width && py >= btn.y && py <= btn.y + btn.height) {
      return btn.index;
    }
  }
  return -1;
}
