/**
 * A "featured event" is a tentpole around which the app builds a temporary,
 * curated experience: the 2026 World Cup today, an Olympic Games or
 * national election next. Everything event-specific (onboarding hero,
 * Flow filter, Worlds battles hook, archive cut-off) reads from a single
 * `FeaturedEvent` instance so the next tentpole plugs in by swapping the
 * constant: no scattered `cat === 'wc'` checks across screens.
 *
 * See `featured-event.constants.ts` for the current instance and
 * `featured-event.derived.ts` for the active/archived derivation.
 */

export type FeaturedEventKind =
	'tournament' | 'championship' | 'election' | 'series' | 'awards' | 'other';

export interface FeaturedEventParticipant {
	/** Stable identifier: ISO-3166 alpha-2 for the WC, candidate slug for an
	 *  election, etc. Used as the join key for advancement markets and as
	 *  the i18n suffix when names are translated. */
	id: string;
	/** Canonical English name. UI should prefer an i18n lookup by `id`
	 *  before falling back to this literal: see `participantLabel` in
	 *  `i18n.utils`. */
	name: string;
	/** Optional emoji glyph (flag, party logo, etc.). Decorative only. */
	glyph?: string;
	/** Brand / accent colour, hex. Used in onboarding hero tiles. */
	color?: string;
	/** Implied probability of winning the event, 0–100. Optional, not
	 *  every event has a clean probability (e.g. awards). */
	winPct?: number;
	/** Market id for the outcome "<participant> wins". Optional: points
	 *  the onboarding hero tile at the right Flow card. */
	marketId?: string;
}

export interface FeaturedEventAdvancementMarket {
	/** Market id (Flow card). */
	id: string;
	/** Pre-baked question copy: kept here so onboarding can render the
	 *  full question before the markets service is hydrated. Translation
	 *  layers over the question via i18n by `id`. */
	q: string;
	/** Implied YES probability, 0–100. */
	yes: number;
}

export interface FeaturedEvent {
	/** Stable event identifier: `'fifa-wc-2026'`, `'usa-election-2028'`, … */
	id: string;
	/** Coarse classification for layout / theming hints. */
	kind: FeaturedEventKind;
	/** Display title, e.g. "2026 FIFA World Cup". UI should look up
	 *  `event.<id>.title` via i18n first. */
	title: string;
	/** Short / compact title used by surfaces with very limited width
	 *  (top-bar deck chip, ticker), e.g. "World Cup". Falls back to
	 *  `title` when omitted. */
	shortTitle?: string;
	/** Title formatted for the onboarding countdown eyebrow, e.g.
	 *  "FIFA World Cup 2026" (event name first, year last). Rendered
	 *  uppercase by the eyebrow. Falls back to `title` when omitted. */
	badgeTitle?: string;
	/** Brand-forward title for high-intent reward surfaces (e.g. the
	 *  onboarding starter-pack line), e.g. "FIFA World Cup"; the full
	 *  brand without the year. Falls back to `shortTitle` then `title`
	 *  when omitted. */
	brandedTitle?: string;
	/** Optional subtitle. Same i18n fallback rule as `title`. */
	subtitle?: string;

	/** Event kickoff time (ms since epoch). Drives onboarding countdown +
	 *  "starts in N days" copy. */
	kickoffAt_ms: number;
	/** Final / closing time (ms since epoch). */
	finalAt_ms: number;
	/** When the app stops rendering event content and falls back to its
	 *  evergreen shape. A buffer past `finalAt_ms` so the post-final
	 *  content stays live for a few days. */
	archiveAfter_ms: number;

	/** Optional category tag carried on markets that belong to this event.
	 *  Markets without this tag are not filtered into event surfaces. */
	categoryTag?: string;

	/** Optional event-specific accent (hex). Falls back to `--laurel`. */
	accentColor?: string;
	/** Optional artwork key: picks the generative artwork ramp used by
	 *  `MarketArtwork` for cards in this event. */
	artworkKey?: string;

	/** All participants (teams / candidates / nominees). */
	participants: FeaturedEventParticipant[];
	/** Subset of `participants.id` highlighted on the onboarding hero:
	 *  the top-4 favourites for a tournament, the front-runners for an
	 *  election, etc. UI reads this directly; participants stays the
	 *  full list. */
	favouriteIds: string[];
	/** Per-participant softer prediction used by onboarding Beat 1 ("Will
	 *  Brazil make the round of 16?"). Indexed by participant id. */
	advancementMarkets?: Record<string, FeaturedEventAdvancementMarket>;

	/** Marketing-only estimate of "people predicting on this event"
	 *  shown in onboarding. Optional. */
	predictorsEstimate?: number;
}

export type FeaturedEventStatus =
	/** `now < kickoffAt_ms`: countdown copy, no live markets yet. */
	| 'upcoming'
	/** `kickoffAt_ms <= now <= finalAt_ms`: the event is running. */
	| 'live'
	/** `finalAt_ms < now <= archiveAfter_ms`: winners known, content
	 *  still surfaced for a buffer window. */
	| 'wrap-up'
	/** `now > archiveAfter_ms`: content hidden, evergreen app shape. */
	| 'archived';
