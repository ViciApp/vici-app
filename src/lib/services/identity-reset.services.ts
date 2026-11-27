import { reconcileIdentityScopedStorage } from '#lib/services/identity-storage.services.ts';
import { receivedReactionsStore } from '#lib/stores/activity-reactions.store.ts';
import { clearAffiliations } from '#lib/stores/affiliations.store.ts';
import { balancesStore } from '#lib/stores/balances.store.ts';
import { collateralsStore } from '#lib/stores/collaterals.store.ts';
import { followingStore } from '#lib/stores/following.store.ts';
import { clearFriendRelations } from '#lib/stores/friends.store.ts';
import { clearLeagues } from '#lib/stores/leagues.store.ts';
import { clearMyMenagerieSignals } from '#lib/stores/menagerie.store.ts';
import { ordersStore } from '#lib/stores/orders.store.ts';
import { positionsStore } from '#lib/stores/positions.store.ts';
import { clearMyReferrals } from '#lib/stores/referrals.store.ts';
import { tradeHistoryStore } from '#lib/stores/trade-history.store.ts';

/**
 * The one reset every auth transition runs (the session hydrate / clear in
 * `Authn`), so one account's data never shows in the next account's UI.
 *
 * Drops the previous account's user-scoped caches; the next `<Loaders />`
 * cycle repopulates them for the new one. Public caches (markets,
 * leaderboard, categories) intentionally stay populated. Clearing the
 * referrals also starts a new referral generation, so a fetch still in
 * flight for the previous account is dropped on arrival. The identity-scoped
 * `localStorage` caches are local-authoritative and only reset when the
 * owner actually changes: see `reconcileIdentityScopedStorage`.
 *
 * `ownerKey` is the signed-in owner (the session account id), `undefined`
 * when signed out.
 */
export const resetIdentityScopedState = ({ ownerKey }: { ownerKey: string | undefined }): void => {
	clearFriendRelations();
	clearAffiliations();
	clearLeagues();
	clearMyMenagerieSignals();
	clearMyReferrals();
	followingStore.set(undefined);
	balancesStore.set(undefined);
	collateralsStore.set(undefined);
	ordersStore.set(undefined);
	positionsStore.set(undefined);
	tradeHistoryStore.set(undefined);
	receivedReactionsStore.set(undefined);

	reconcileIdentityScopedStorage({ ownerKey });
};
