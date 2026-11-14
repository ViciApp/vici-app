import { CHAR_CREAM } from '#lib/constants/characters.constants.ts';

/**
 * Inline `background`/`color` style for an affiliation chip; the
 * roster entry's brand `color` as the fill with its paired `text`
 * foreground, falling back to the parchment cream when `text` is
 * absent. Empty string when no brand colour is set, so the chip's CSS
 * default (laurel accent / neutral surface) applies.
 */
export const affiliationChipStyle = ({ color, text }: { color?: string; text?: string }): string =>
	color ? `background: ${color}; color: ${text ?? CHAR_CREAM};` : '';
