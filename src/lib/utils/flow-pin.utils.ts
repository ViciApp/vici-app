import { HOUR_IN_MS } from '#lib/constants/app.constants.ts';
import {
	del as storageDel,
	get as storageGet,
	set as storageSet
} from '#lib/utils/storage.utils.ts';
import { nonNullish, notEmptyString } from '@dfinity/utils';

/**
 * A market id parked when the viewer opens a shared prediction link
 * (`/m/{id}` → market detail). The next Flow entry consumes it and surfaces
 * that market as the first card, so a friend who shared a market drops you
 * straight onto it the moment you start swiping. Honors the usual deck rules
 * downstream: a market the viewer already called is never pinned (see
 * `prepareFlow`).
 *
 * Persisted (not in-memory) because the handoff has to survive the detail
 * page, sign-in, and, for a brand-new user, the whole onboarding flow
 * before Flow ever opens. localStorage, reusing `storage.utils`, for parity
 * with the other persisted Flow keys (`vici.flow.daily-goal.v1`). Consumed
 * (cleared) on the first read so it pins exactly once, and TTL-bounded so a
 * link opened-and-forgotten in an earlier session never hijacks a later
 * organic Flow entry.
 */
const FLOW_PIN_STORAGE_KEY = 'vici.flow.pinned-market.v1';

// An hour comfortably covers "click link → detail → sign up → onboard → Flow"
// while keeping a stale pin from resurfacing days later.
const FLOW_PIN_TTL_MS = HOUR_IN_MS;

interface PinnedFlowMarket {
	id: string;
	atMs: number;
}

const isPinnedFlowMarket = (value: unknown): value is PinnedFlowMarket =>
	nonNullish(value) &&
	notEmptyString((value as PinnedFlowMarket).id) &&
	Number.isFinite((value as PinnedFlowMarket).atMs);

/**
 * Park a market id to surface first on the next Flow entry. Called from the
 * `/m/{id}` shared-link redirect: the only route ever reached from the share
 * sheet, so a visit there is an unambiguous "arrived from a shared link"
 * signal.
 */
export const setPinnedFlowMarket = (id: string): void => {
	if (!notEmptyString(id)) {
		return;
	}

	storageSet<PinnedFlowMarket>({ key: FLOW_PIN_STORAGE_KEY, value: { id, atMs: Date.now() } });
};

/**
 * Read and clear the parked market id. Returns `undefined` when none is
 * parked, the stored entry is malformed, or it has aged past
 * {@link FLOW_PIN_TTL_MS}. Always clears the key so the pin fires once.
 */
export const consumePinnedFlowMarket = (): string | undefined => {
	const raw = storageGet<PinnedFlowMarket>({ key: FLOW_PIN_STORAGE_KEY });

	// Clear unconditionally: even when the read came back missing OR
	// malformed. A corrupt value surfaces from `storageGet` as `undefined`
	// (the parse error is swallowed there), so gating the delete on a
	// non-nullish result would leave a bad entry behind to re-trigger the
	// failed parse on every Flow mount. removeItem on an absent key is a
	// cheap no-op, and pins fire at most once anyway.
	storageDel({ key: FLOW_PIN_STORAGE_KEY });

	if (!isPinnedFlowMarket(raw)) {
		return;
	}

	return Date.now() - raw.atMs <= FLOW_PIN_TTL_MS ? raw.id : undefined;
};
