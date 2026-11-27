import type {
	LandingDeckMedia,
	LandingDeckMediaCut,
	LandingDeckMediaKey,
	LandingDeckOrientation,
	LandingDeckSeries
} from '#lib/types/landing.ts';

const DECK_MEDIA_DIR = '/landing/deck';

const TALL_ASPECT_RATIO = 720 / 1280;
const WIDE_ASPECT_RATIO = 1920 / 1072;

const cut = ({
	key,
	orientation
}: {
	key: LandingDeckMediaKey;
	orientation: LandingDeckOrientation;
}): LandingDeckMediaCut => {
	const base = `${DECK_MEDIA_DIR}/${key}-${orientation}`;

	return {
		stillJpg: `${base}.jpg`,
		stillWebp: `${base}.webp`,
		clipMp4: `${base}.mp4`,
		clipWebm: `${base}.webm`,
		aspectRatio: orientation === 'tall' ? TALL_ASPECT_RATIO : WIDE_ASPECT_RATIO
	};
};

const media = (key: LandingDeckMediaKey): LandingDeckMedia => ({
	tall: cut({ key, orientation: 'tall' }),
	wide: cut({ key, orientation: 'wide' })
});

/**
 * Footage per deck card, served from `static/landing/deck/`. Each card has an
 * upright cut for portrait screens and a wide cut for landscape ones; each
 * cut is a still (the loop's first frame) plus a short silent clip in two
 * encodings. Filenames are stable: replacing a file swaps the footage with
 * no code change.
 */
export const LANDING_DECK_MEDIA: Record<LandingDeckMediaKey, LandingDeckMedia> = {
	gta: media('gta'),
	btc: media('btc'),
	barca: media('barca')
};

/** `type` of each clip `<source>`, in the order the browser should try them. */
export const LANDING_DECK_CLIP_TYPE_WEBM = 'video/webm; codecs="av01.0.08M.08"';
export const LANDING_DECK_CLIP_TYPE_MP4 = 'video/mp4';

export const LANDING_DECK_DEFAULT_WIDE_FOCUS = '50% 58%';

/**
 * The three curated series of the landing deck, in deck order, by their
 * registry series id. A card whose series does not load, or is no longer an
 * open Yes/No market, is left out of the deck: all three close by
 * 31 December 2026, so the deck needs new series before then.
 */
export const LANDING_DECK_SERIES: readonly LandingDeckSeries[] = [
	{
		seriesId: 'fbf8a877ad82426660f382415be1adb68c502f492fc20a2d9f1144a76e754ec8',
		media: 'gta',
		category: 'gaming',
		wideFocus: '50% 56%'
	},
	{
		seriesId: 'e3f25f5843d422a460bd7ba82501747032a22318bacce84feedfaa00c18de161',
		media: 'btc',
		category: 'economy',
		wideFocus: '50% 50%',
		seam: 0.743
	},
	{
		seriesId: 'acf88eb24cddee183bd10473a7dbb15157b072e1a8d348d9c416d7bcf31c9504',
		media: 'barca',
		category: 'sports',
		wideFocus: '50% 50%'
	}
];

/** Calls after which the deck hands over to the page (`ondone`) and offers the claim. */
export const LANDING_DECK_CALLS_TO_DONE = 3;

/** How often the deck re-reads its series while the tab is visible. */
export const LANDING_DECK_REFRESH_INTERVAL_MS = 30_000;

/** At or below this width a tap turns the card over in 3D; wider screens reveal the back in place. */
export const LANDING_DECK_FLIP_3D_MAX_WIDTH = 760;

/** How long a thrown card needs to clear the screen before the deck drops it. */
export const LANDING_DECK_EXIT_MS = 520;

/** How long the line confirming a call or a pass stays up. */
export const LANDING_DECK_STATUS_MS = 1600;

/** How long a returning visitor sees the "your turn" hint. */
export const LANDING_DECK_RETURNING_HINT_MS = 3200;

/** Pause between the completing call and the claim, when the claim is the next step. */
export const LANDING_DECK_CLAIM_DELAY_MS = 900;

/**
 * Idle nudge: until the first call, a card left alone for
 * `LANDING_DECK_NUDGE_IDLE_MS` leans `LANDING_DECK_NUDGE_PX` to the side and
 * back, checked every `LANDING_DECK_NUDGE_EVERY_MS`.
 */
export const LANDING_DECK_NUDGE_EVERY_MS = 5000;
export const LANDING_DECK_NUDGE_IDLE_MS = 4000;
export const LANDING_DECK_NUDGE_PX = 14;
export const LANDING_DECK_NUDGE_RETURN_MS = 420;

/**
 * The clip rests while a finger is down, so decoding never costs the drag a
 * frame. It resumes this long after the release, and only once the card is
 * back within `LANDING_DECK_CLIP_REST_PX` of rest.
 */
export const LANDING_DECK_CLIP_WAKE_MS = 320;
export const LANDING_DECK_CLIP_REST_PX = 2;

/** The introduction starts this long after the first card is up, and again after the tab returns. */
export const LANDING_DECK_ATTRACT_START_MS = 1500;
export const LANDING_DECK_ATTRACT_RESUME_MS = 600;
/** How far the card sinks under the hand while the introduction rocks it. */
export const LANDING_DECK_ATTRACT_DROP_PX = 16;
