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
 * The three curated series of the landing deck, in deck order.
 *
 * The `seriesId` values are placeholders until the curated series exist on
 * the registry: a card whose series does not load is left out of the deck, so
 * with these values the deck renders no card at all. Replace each with the
 * real registry series id.
 */
export const LANDING_DECK_SERIES: readonly LandingDeckSeries[] = [
	{
		seriesId: 'PLACEHOLDER_SERIES_ID_GTA_VI_40M_COPIES_BY_2026_12_31',
		media: 'gta',
		category: 'gaming',
		wideFocus: '50% 56%'
	},
	{
		seriesId: 'PLACEHOLDER_SERIES_ID_BITCOIN_ABOVE_60K_ON_2026_12_31',
		media: 'btc',
		category: 'economy',
		wideFocus: '50% 50%',
		seam: 0.743
	},
	{
		seriesId: 'PLACEHOLDER_SERIES_ID_BARCA_TOP_OF_LA_LIGA_ON_2026_12_31',
		media: 'barca',
		category: 'sports',
		wideFocus: '50% 50%'
	}
];

/**
 * Query parameter of a shared question's link: `/?m=<slug~id8>` opens the
 * landing on that market, in the same encoding as the public `/m/{param}`
 * route (`marketShareParam`). The deck writes it into the links it shares;
 * the page resolves it to a series id and passes that as the deck's
 * `leadSeriesId`.
 */
export const LANDING_DECK_QUESTION_PARAM = 'm';

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
