import {
	INBOX_DISMISSED_STORAGE_KEY,
	INBOX_PROGRESS_STORAGE_KEY,
	INBOX_READ_STORAGE_KEY,
	INBOX_SETTLED_READ_STORAGE_KEY
} from '#lib/constants/inbox.constants.ts';
import { clearDailyGoalMirror } from '#lib/utils/daily-goal.utils.ts';
import { resetMotionState } from '#lib/utils/motion-engine.utils.ts';
import { clearOnboardingSeenFlags } from '#lib/utils/onboarding-flags.utils.ts';
import { del, get, set } from '#lib/utils/storage.utils.ts';
import { isNullish } from '@dfinity/utils';

// Principal the identity-scoped caches currently belong to. Persisted so a
// same-user reload is distinguishable from a real identity change.
const STORAGE_OWNER_KEY = 'vici.storage-owner.v1';

/**
 * Drop the browser-persisted, identity-scoped caches when the signed-in
 * principal changes to a different *defined* owner (sign-in as a different
 * user, account switch), so one identity's state never bleeds into the next
 * on a shared device. The signed-out (`undefined`) transition does NOT clear
 * — see the note below.
 *
 * Only clears on an actual owner change — NOT on a same-user reload, which
 * would defeat the offline-resilient daily-goal mirror (it exists to survive
 * a refresh after a dropped server write). Scope is local-authoritative state
 * with no server copy to reload from; server-backed caches are handled
 * separately in `Authn`.
 *
 * First observation (no persisted owner yet) counts as a change and clears:
 * that's intentional, so already-affected devices from before this guard
 * shipped get cleaned on the next sign-in rather than keeping their leak. The
 * daily-goal profile reconcile re-establishes the real count immediately.
 *
 * The signed-out transition (`ownerKey === undefined`) is a no-op: it neither
 * clears nor forgets the persisted owner. `onAuthStateChange` emits a transient
 * `null` user during bootstrap *before* the restored session resolves, so
 * clearing here would wipe a returning user's local-authoritative state (e.g.
 * inbox "mark all read") on every single sign-in. Cross-account safety is
 * unaffected: the next *defined* owner is compared against the still-remembered
 * previous owner, so a genuine account switch (A → B) still clears.
 */
export const reconcileIdentityScopedStorage = ({
	ownerKey
}: {
	ownerKey: string | undefined;
}): void => {
	// Ignore the signed-out / bootstrap `null` transition — keep the remembered
	// owner so a same-user re-auth is recognised and not treated as a switch.
	if (isNullish(ownerKey)) {
		return;
	}

	const previousOwner = get<string>({ key: STORAGE_OWNER_KEY });

	if (previousOwner === ownerKey) {
		return;
	}

	clearDailyGoalMirror();
	resetMotionState();
	clearOnboardingSeenFlags();
	// Inbox read-state: delete the persisted keys directly. We deliberately
	// don't import `inbox.store` (it starts a long-lived toast subscription
	// at import, and <Authn> is in the root layout that also wraps the
	// signed-out/marketing path). The in-memory inbox stores re-read these
	// keys on their next load, which is when the next identity opens the app.
	del({ key: INBOX_SETTLED_READ_STORAGE_KEY });
	del({ key: INBOX_READ_STORAGE_KEY });
	del({ key: INBOX_DISMISSED_STORAGE_KEY });
	del({ key: INBOX_PROGRESS_STORAGE_KEY });

	set({ key: STORAGE_OWNER_KEY, value: ownerKey });
};
