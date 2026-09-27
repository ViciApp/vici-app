import { Collection } from '$lib/constants/collections.constants';
import { isNullish, nonNullish } from '@dfinity/utils';
import type { AssertSetDocContext } from '@junobuild/functions';
import { canisterSelf } from '@junobuild/functions/ic-cdk';
import { decodeDocData, getAdminAccessKeys, getDocStore } from '@junobuild/functions/sdk';

/**
 * New accounts are created on the new stack only; this satellite keeps
 * serving the accounts it already holds. The legacy frontend turns new users
 * away before it writes anything, and this gate makes the same rule hold for
 * a modified client: creating a `profiles` doc is refused, and so is creating
 * a `profile_private` doc for a principal that has no profile. Updates to
 * existing docs, and every serverless write (all of which update existing
 * profiles), pass untouched.
 *
 * Kill switch: a controller writes the `app_config` doc keyed
 * {@link APP_CONFIG_NEW_PROFILE_GATE_KEY} with data `{ "enabled": false }`
 * (Juno Console, Datastore, `app_config`). Deleting the doc, or setting
 * `enabled` back to `true`, re-arms the gate. No doc means armed.
 */
export const APP_CONFIG_NEW_PROFILE_GATE_KEY = 'new_profile_gate';

export interface NewProfileGateConfig {
	enabled?: boolean;
}

/**
 * The Juno emulator's fixed satellite id (mirrors `EMULATOR_SATELLITE_ID` in
 * `juno.config.ts`). The Playwright suite creates brand-new profiles there on
 * every run, and it has no controller identity to write the kill switch with.
 * A deployed satellite can never carry this id, so the exemption cannot be
 * reached in production.
 */
const GATE_EXEMPT_SATELLITE_IDS: readonly string[] = ['jx5yt-yyaaa-aaaal-abzbq-cai'];

const isGateArmed = (): boolean => {
	if (GATE_EXEMPT_SATELLITE_IDS.includes(canisterSelf().toText())) {
		return false;
	}

	// `app_config` is controllers-scoped and the store APIs enforce the rule
	// against the caller they are given, so read it as a controller. With no
	// controller to read as, stay armed: failing open would re-open sign-ups.
	const admin = getAdminAccessKeys()[0]?.[0];

	if (isNullish(admin)) {
		return true;
	}

	const doc = getDocStore({
		collection: Collection.APP_CONFIG,
		key: APP_CONFIG_NEW_PROFILE_GATE_KEY,
		caller: admin
	});

	if (isNullish(doc)) {
		return true;
	}

	return decodeDocData<NewProfileGateConfig>(doc.data).enabled !== false;
};

const hasProfile = ({ key, caller }: { key: string; caller: Uint8Array }): boolean =>
	nonNullish(getDocStore({ collection: Collection.PROFILES, key, caller }));

/**
 * Pre-write veto shared by the `profiles` and `profile_private` asserts. Only
 * a CREATE (no `current` doc) is ever inspected. A `profile_private` create is
 * legitimate for an existing account that never stored an email (the sign-in
 * email backfill writes it), so that collection is gated on the profile.
 */
export const assertNewProfileAllowed = ({
	caller,
	data: {
		collection,
		key,
		data: { current }
	}
}: AssertSetDocContext): void => {
	if (nonNullish(current)) {
		return;
	}

	if (collection === Collection.PROFILE_PRIVATE && hasProfile({ key, caller })) {
		return;
	}

	if (collection !== Collection.PROFILES && collection !== Collection.PROFILE_PRIVATE) {
		return;
	}

	if (!isGateArmed()) {
		return;
	}

	throw new Error('New accounts are created on vici.app.');
};
