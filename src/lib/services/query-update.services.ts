import { getIdentityOrAnonymous } from '#lib/services/identity.services.ts';
import {
	queryAndUpdate,
	type QueryAndUpdatePromiseResolution,
	type QueryAndUpdateStrategy
} from '@dfinity/utils';
import type { Identity } from '@icp-sdk/core/agent';

export interface LoadWithCertificationParams<R> {
	request: (options: { certified: boolean; identity: Identity }) => Promise<R>;
	onLoad: (options: { certified: boolean; response: R }) => void;
	onUpdateError?: (error: unknown) => void;
	onQueryError?: (error: unknown) => void;
	strategy?: QueryAndUpdateStrategy;
	resolution?: QueryAndUpdatePromiseResolution;
	identity?: Identity;
}

/**
 * Project wrapper around `@dfinity/utils` `queryAndUpdate`.
 *
 * Runs an uncertified query and a certified update against the IC, delivering each
 * result to `onLoad` as soon as it resolves (query first, then update). Stale query
 * responses that arrive after the update has already resolved are dropped by the
 * underlying `queryAndUpdate` implementation.
 *
 * Use this for read paths that are exposed over both query and update calls,
 * typically anything routed through a `@dfinity/utils` `Canister` (e.g. registry,
 * clearing) or an `@icp-sdk/canisters` canister (ledger, index). Juno satellite
 * `functions.*` reads do NOT have an update flavor and cannot be used with this.
 *
 * Resolves with `AnonymousIdentity` when no user is signed in, mirroring
 * `getIdentityOrAnonymous`.
 */
export const loadWithCertification = async <R>({
	request,
	onLoad,
	onUpdateError,
	onQueryError,
	strategy = 'query_and_update',
	resolution = 'race',
	identity: identityOverride
}: LoadWithCertificationParams<R>): Promise<void> => {
	const identity = identityOverride ?? (await getIdentityOrAnonymous());

	return queryAndUpdate<R>({
		request: ({ certified }) => request({ certified, identity }),
		onLoad,
		onQueryError: ({ error }) => {
			// Uncertified query failures are non-fatal: the update call still runs and
			// will deliver a verified result. We log for visibility but don't rethrow.
			console.warn('[queryAndUpdate] uncertified query failed', error);
			onQueryError?.(error);
		},
		onUpdateError: ({ error }) => {
			console.error('[queryAndUpdate] certified update failed', error);
			onUpdateError?.(error);
		},
		strategy,
		resolution,
		identity
	});
};
