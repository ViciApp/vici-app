<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import type { ClearingDid } from '#declarations';
	import IdentityAwareLoader from '#lib/components/loaders/IdentityAwareLoader.svelte';
	import { ZERO } from '#lib/constants/app.constants.ts';
	import { SUPPORTED_TOKENS } from '#lib/constants/tokens/tokens.ic.constants.ts';
	import { balanceDomain } from '#lib/derived/balance-domain.derived.ts';
	import { loadAccountState, loadCollateralAssets } from '#lib/services/collateral.services.ts';
	import { collateralsStore } from '#lib/stores/collaterals.store.ts';
	import type { TokenId } from '#lib/types/token.ts';
	import { findSupportedTokenForClearingAssetId } from '#lib/utils/asset-ref.utils.ts';
	import { compareBalanceDomains, isSettlement } from '#lib/utils/balance-domain.utils.ts';

	let prevDomain: ClearingDid.BalanceDomain | undefined = undefined;

	const refresh = async ({ resetStore = false } = {}) => {
		const domainToken = $balanceDomain;

		if (resetStore) {
			collateralsStore.set(undefined);
		}

		// Local "latest" cache for both streams: loadAccountState and
		// loadCollateralAssets fire onLoad up to twice each (query + update). We
		// recompute the aggregated store shape every time either arrives so the UI
		// reflects the freshest data from both sides.
		let latestAccountState: ClearingDid.AccountStateResponse | undefined;
		let latestAssets: ClearingDid.CollateralAssetInfo[] | undefined;

		const recompute = () => {
			// Narrow once via local aliases so TS knows they're defined in closures below.
			const accountState = latestAccountState;
			const assets = latestAssets;

			if (isNullish(accountState) || isNullish(assets)) {
				return;
			}

			// Domain changed mid-flight: drop the stale result.
			if (!compareBalanceDomains($balanceDomain, domainToken)) {
				return;
			}

			const assetsConfig: Record<string, ClearingDid.CollateralAssetInfo> = {};

			assets.forEach((asset) => {
				assetsConfig[asset.config.asset_id] = asset;
			});

			const collateral: Record<TokenId, bigint> = {};
			const targetDomainBalances = accountState.state.balances.find(([d]) =>
				compareBalanceDomains(d, domainToken)
			);

			if (nonNullish(targetDomainBalances)) {
				const [, domainBalances] = targetDomainBalances;
				domainBalances.forEach(([assetId, balance]) => {
					const token = findSupportedTokenForClearingAssetId({
						assetId,
						collateralInfos: assets,
						supportedTokens: SUPPORTED_TOKENS
					});

					if (nonNullish(token)) {
						collateral[token.id] = (collateral[token.id] ?? ZERO) + balance;
					}
				});
			}

			collateralsStore.set({
				balances: collateral,
				accountState,
				assetsConfig
			});
		};

		await Promise.all([
			loadAccountState({
				domain: domainToken,
				onLoad: ({ certified, response }) => {
					// The clearing `get_account_state_query` computes its top-level
					// `total_equity_usd` / `available_margin_usd` for the Settlement
					// domain only (it takes no domain param). On any other domain those
					// figures read as the Settlement account (typically zero), so
					// letting the fast uncertified result through flashes "In play" and
					// "Available" to 0 on every refresh until the certified update
					// lands. Outside Settlement, only certified responses are trusted.
					if (!certified && !isSettlement(domainToken)) {
						return;
					}

					latestAccountState = response;
					recompute();
				}
			}),
			loadCollateralAssets({
				onLoad: ({ response }) => {
					latestAssets = response;
					recompute();
				}
			})
		]);
	};

	$effect(() => {
		if ($balanceDomain && (!prevDomain || !compareBalanceDomains($balanceDomain, prevDomain))) {
			prevDomain = $balanceDomain;
			refresh({ resetStore: true });
		}
	});
</script>

<svelte:window onviciRefreshCollaterals={() => refresh()} />

<IdentityAwareLoader onLoad={refresh} />
