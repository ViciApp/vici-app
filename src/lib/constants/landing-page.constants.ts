import { PublicPath } from '#lib/constants/routes.constants.ts';
import { DAY_IN_MS } from '#lib/constants/time.constants.ts';

/** The calls a signed-out visitor made on the landing, kept for the claim that follows. */
export const LANDING_CALLS_STORAGE_KEY = 'vici.landing.calls.v1';

/** Only the latest calls are kept: the claim carries a handful, not a history. */
export const LANDING_CALLS_MAX = 10;

/** A call older than this is forgotten: its price no longer says anything. */
export const LANDING_CALLS_TTL_MS = 7 * DAY_IN_MS;

/** Set once a visitor has touched the deck, so a later visit skips its introduction. */
export const LANDING_DECK_SEEN_STORAGE_KEY = 'vici.landing.deck-seen.v1';

/** How long the top-bar button reads "Shared" after a market's link was shared. */
export const LANDING_SHARE_NUDGE_MS = 4200;

/** A Markets call shows its confirmation before the claim capsule opens over it. */
export const LANDING_MARKETS_ACK_DELAY_MS = 170;

/**
 * The deck card that floats into the Markets lead: the whole flight, the
 * card's own text leaving first, the footage veil lifting, and the final
 * cross-fade into the lead's artwork.
 */
export const LANDING_FLOAT_MS = 620;
export const LANDING_FLOAT_TEXT_FADE_MS = 150;
export const LANDING_FLOAT_VEIL_FADE_MS = 380;
export const LANDING_FLOAT_LAND_FADE_MS = 120;
export const LANDING_FLOAT_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';

/** How long a lifted card waits for Markets to show its lead before it gives up and fades. */
export const LANDING_FLOAT_WAIT_MS = 1500;
export const LANDING_FLOAT_MISS_FADE_MS = 200;

/** Corner radius of the Markets lead artwork the card lands on. */
export const LANDING_FLOAT_LAND_RADIUS_PX = 14;

/** The deck card scales around this point (`transform-origin: 50% 60%`). */
export const LANDING_FLOAT_ORIGIN_Y = 0.6;

/** Literal paths, so the landing does not bundle the legal texts. */
export const LANDING_TERMS_PATH = `${PublicPath.Info}/terms` as const;

/**
 * The headline face, preloaded by the landing only. Must match the
 * `Bricolage Grotesque` `@font-face` source in `src/app.css`.
 */
export const LANDING_HEADLINE_FONT_SRC = '/fonts/bricolage-grotesque-variable-latin.woff2';

/**
 * The landing's link preview: the card under `static/` and its headline. A
 * link preview is read from the built shell, before the app or a locale
 * exists, so the headline is English and lives here, not in the catalogs.
 * Written into the shell by `scripts/build/generate-shell-head.ts`.
 */
export const LANDING_SHARE_IMAGE_PATH = '/branding/landing-share.jpg';
export const LANDING_SHARE_IMAGE_TYPE = 'image/jpeg';
export const LANDING_SHARE_IMAGE_WIDTH = 1200;
export const LANDING_SHARE_IMAGE_HEIGHT = 630;
export const LANDING_SHARE_TITLE = 'VICI. Call it.';
