import { CONTACT_DOMAIN } from '#lib/constants/contact.constants.ts';
import type { CallSide } from '#lib/types/market.ts';
import type { FlowArtCategory } from '#lib/utils/flow-art.utils.ts';
import { tagColor } from '#lib/utils/tag-color.utils.ts';
import { isNullish, nonNullish } from '@dfinity/utils';

/**
 * Client-side renderer for the shareable prediction card: a 1080×1920
 * story-format PNG drawn on an offscreen `<canvas>`, on-brand, so it can
 * be posted to image-only surfaces (Instagram / TikTok / Snapchat /
 * Facebook stories) that don't accept links.
 *
 * The card is intentionally rendered against a fixed dark palette
 * regardless of the app theme: a story image lives outside the app and
 * reads best on the brand "ink" background. Fonts are the self-hosted
 * faces declared in `app.css`; we await `document.fonts.ready` so the
 * canvas picks them up instead of falling back to a system face.
 */

/** Fixed brand palette for the rendered card (theme-independent). */
const CARD_BG = '#0E0D0B';
const CARD_FG = '#F2ECDC';
const CARD_MUTE = '#8A8278';
const CARD_YES = '#4FD3A1';
const CARD_NO = '#FF6B6B';

export interface ShareCardMarket {
	id: string;
	question: string;
	yesPercent: number;
	category: FlowArtCategory;
}

export interface ShareCardPriorCall {
	side: CallSide;
}

export interface ShareCardIdentity {
	handle: string;
	/** Accuracy as a 0–1 fraction; omit to hide the accuracy line. */
	accuracy?: number;
}

export interface ShareCardResult {
	blob: Blob;
	dataUrl: string;
}

/** Convert a hex color to an `rgba()` string with the given alpha. */
// eslint-disable-next-line local-rules/prefer-object-params -- color + alpha read best positionally
const hexA = (hex: string, alpha: number): string => {
	const h = hex.replace('#', '');
	const full =
		h.length === 3
			? h
					.split('')
					.map((c) => c + c)
					.join('')
			: h;
	const n = parseInt(full, 16);

	return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

/** Trace a rounded rectangle path (does not stroke / fill). */
// eslint-disable-next-line local-rules/prefer-object-params -- mirrors the positional Canvas 2D geometry API
const roundRectPath = (
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number
): void => {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
};

/** Greedy word-wrap against a max pixel width using the live ctx font. */
// eslint-disable-next-line local-rules/prefer-object-params -- ctx + text + width read best positionally
const wrapLines = (ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] => {
	const words = String(text).split(/\s+/);
	const lines: string[] = [];
	let line = '';

	for (const word of words) {
		const test = line ? `${line} ${word}` : word;

		if (ctx.measureText(test).width > maxW && line) {
			lines.push(line);
			line = word;
		} else {
			line = test;
		}
	}

	if (line) {
		lines.push(line);
	}

	return lines;
};

/**
 * `letterSpacing` is non-standard on `CanvasRenderingContext2D` and
 * absent in older engines. Guard each set so the render never throws on
 * an unsupported canvas implementation.
 */
// eslint-disable-next-line local-rules/prefer-object-params -- ctx + value read best positionally
const setLetterSpacing = (ctx: CanvasRenderingContext2D, value: string): void => {
	try {
		(ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = value;
	} catch {
		// Unsupported: spacing is cosmetic, render continues.
	}
};

/**
 * Render the prediction card to a PNG. Returns `null` when the
 * environment can't paint a canvas (SSR, no 2D context, or
 * `toBlob`/`toDataURL` unavailable) so callers can fall back to a
 * link-only share.
 */
export const renderPredictionCard = async ({
	market,
	priorCall,
	identity
}: {
	market: ShareCardMarket;
	priorCall?: ShareCardPriorCall | null;
	identity: ShareCardIdentity;
}): Promise<ShareCardResult | null> => {
	if (typeof document === 'undefined') {
		return null;
	}

	try {
		if (nonNullish(document.fonts?.ready)) {
			await document.fonts.ready;
		}
	} catch {
		// Font readiness is best-effort; proceed with whatever is loaded.
	}

	const W = 1080;
	const H = 1920;
	const PAD = 110;

	const canvas = document.createElement('canvas');
	canvas.width = W;
	canvas.height = H;

	const ctx = canvas.getContext('2d');

	if (isNullish(ctx)) {
		return null;
	}

	// `wc` and unknowns fall back to the laurel-gold accent inside `tagColor`.
	const accent = tagColor(market.category);
	const yes = Math.max(0, Math.min(100, Math.round(market.yesPercent)));

	// Background + accent glow + frame.
	ctx.fillStyle = CARD_BG;
	ctx.fillRect(0, 0, W, H);
	const glow = ctx.createRadialGradient(W * 0.5, H * 0.2, 40, W * 0.5, H * 0.2, W * 0.95);
	glow.addColorStop(0, hexA(accent, 0.18));
	glow.addColorStop(1, 'rgba(0,0,0,0)');
	ctx.fillStyle = glow;
	ctx.fillRect(0, 0, W, H);
	ctx.strokeStyle = hexA(CARD_FG, 0.09);
	ctx.lineWidth = 2;
	roundRectPath(ctx, 44, 44, W - 88, H - 88, 46);
	ctx.stroke();

	// Header: wordmark + category tag.
	ctx.textBaseline = 'alphabetic';
	ctx.fillStyle = CARD_FG;
	ctx.font = '700 48px "Hanken Grotesk", system-ui, sans-serif';
	setLetterSpacing(ctx, '8px');
	ctx.fillText('VICI', PAD, 188);
	setLetterSpacing(ctx, '4px');
	ctx.font = '700 27px "JetBrains Mono", monospace';
	const cat = String(market.category || 'MARKET').toUpperCase();
	const cw = ctx.measureText(cat).width;
	ctx.fillStyle = accent;
	ctx.fillText(cat, W - PAD - cw, 184);
	setLetterSpacing(ctx, '0px');
	ctx.strokeStyle = hexA(CARD_FG, 0.1);
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(PAD, 232);
	ctx.lineTo(W - PAD, 232);
	ctx.stroke();

	// Question.
	ctx.fillStyle = CARD_FG;
	ctx.font = '600 78px "Hanken Grotesk", system-ui, sans-serif';
	const lines = wrapLines(ctx, market.question, W - PAD * 2).slice(0, 6);
	let qy = 420;
	const lh = 96;
	lines.forEach((l) => {
		ctx.fillText(l, PAD, qy);
		qy += lh;
	});

	// Call / consensus block.
	const blockY = Math.max(qy + 80, 1120);

	if (priorCall) {
		const side = String(priorCall.side).toUpperCase();
		const col = side === 'YES' ? CARD_YES : CARD_NO;
		ctx.fillStyle = CARD_MUTE;
		ctx.font = '700 30px "JetBrains Mono", monospace';
		setLetterSpacing(ctx, '6px');
		ctx.fillText('MY CALL', PAD, blockY);
		setLetterSpacing(ctx, '0px');
		ctx.fillStyle = col;
		ctx.font = 'italic 168px "Instrument Serif", Georgia, serif';
		ctx.fillText(side, PAD - 4, blockY + 168);
	} else {
		ctx.fillStyle = CARD_MUTE;
		ctx.font = '700 30px "JetBrains Mono", monospace';
		setLetterSpacing(ctx, '6px');
		ctx.fillText('CONSENSUS', PAD, blockY);
		setLetterSpacing(ctx, '0px');
		ctx.fillStyle = CARD_FG;
		ctx.font = 'italic 168px "Instrument Serif", Georgia, serif';
		const pctStr = `${yes}%`;
		ctx.fillText(pctStr, PAD - 4, blockY + 168);
		const pctW = ctx.measureText(pctStr).width;
		ctx.fillStyle = CARD_YES;
		ctx.font = '600 46px "Hanken Grotesk", system-ui, sans-serif';
		ctx.fillText('YES', PAD - 4 + pctW + 20, blockY + 130);
	}

	// Consensus bar.
	const barY = blockY + 250;
	const barH = 18;
	const barW = W - PAD * 2;
	ctx.fillStyle = hexA(CARD_NO, 0.22);
	roundRectPath(ctx, PAD, barY, barW, barH, 9);
	ctx.fill();
	ctx.fillStyle = CARD_YES;
	roundRectPath(ctx, PAD, barY, Math.max(barH, (barW * yes) / 100), barH, 9);
	ctx.fill();
	ctx.fillStyle = CARD_MUTE;
	ctx.font = '600 26px "JetBrains Mono", monospace';
	ctx.fillText(`${yes}% YES`, PAD, barY + 64);
	const noLabel = `${100 - yes}% NO`;
	ctx.fillText(noLabel, W - PAD - ctx.measureText(noLabel).width, barY + 64);

	// Identity + footer.
	const handle = `@${identity.handle || 'predictor'}`;
	const acc = nonNullish(identity.accuracy)
		? `${Math.round(identity.accuracy * 100)}% accuracy`
		: '';
	ctx.fillStyle = CARD_FG;
	ctx.font = '600 38px "Hanken Grotesk", system-ui, sans-serif';
	ctx.fillText(handle, PAD, H - 250);

	if (acc) {
		ctx.fillStyle = CARD_MUTE;
		ctx.font = '500 30px "JetBrains Mono", monospace';
		ctx.fillText(acc, PAD, H - 206);
	}

	ctx.strokeStyle = hexA(CARD_FG, 0.1);
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(PAD, H - 168);
	ctx.lineTo(W - PAD, H - 168);
	ctx.stroke();
	ctx.fillStyle = CARD_MUTE;
	ctx.font = '700 26px "JetBrains Mono", monospace';
	setLetterSpacing(ctx, '5px');
	ctx.fillText('VENI · VIDI · VICI', PAD, H - 110);
	setLetterSpacing(ctx, '0px');
	ctx.fillStyle = accent;
	ctx.font = '600 32px "Hanken Grotesk", system-ui, sans-serif';
	const dom = CONTACT_DOMAIN;
	ctx.fillText(dom, W - PAD - ctx.measureText(dom).width, H - 108);

	if (typeof canvas.toBlob !== 'function' || typeof canvas.toDataURL !== 'function') {
		return null;
	}

	const blob = await new Promise<Blob | null>((resolve) => {
		canvas.toBlob((b) => resolve(b), 'image/png', 0.92);
	});

	if (isNullish(blob)) {
		return null;
	}

	return { blob, dataUrl: canvas.toDataURL('image/png') };
};
