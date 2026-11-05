<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { get } from 'svelte/store';
	import { ZERO } from '#lib/constants/app.constants.ts';
	import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
	import { depositCollateral, getSweepableVxpAmount } from '#lib/services/collateral.services.ts';
	import { balanceDomainStore } from '#lib/stores/balance-domain.store.ts';

	/**
	 * Playground-only sweep of VXP ledger balance into clearing (ViciXp).
	 *
	 * Timer + deposit loop lives in `$effect` keyed on `isPlayground`; cleanup clears timeouts and
	 * drops `alive` so async work cannot reschedule after teardown or domain switch.
	 */
	const POLL_MS = 10_000;

	const isPlayground = $derived($balanceDomainStore.value === 'playground');

	let inFlight = $state(false);

	$effect(() => {
		if (!isPlayground) {
			return;
		}

		let alive = true;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;

		const clearTimer = () => {
			if (nonNullish(timeoutId)) {
				clearTimeout(timeoutId);
				timeoutId = undefined;
			}
		};

		const playgroundNow = (): boolean => get(balanceDomainStore).value === 'playground';

		const scheduleNext = () => {
			if (!alive || !playgroundNow()) {
				return;
			}

			clearTimer();
			timeoutId = setTimeout(() => {
				void run();
			}, POLL_MS);
		};

		const run = async () => {
			if (!alive || !playgroundNow()) {
				return;
			}

			if (inFlight) {
				scheduleNext();

				return;
			}

			// The service owns the balance / fee reads (and their per-backend
			// transport); it resolves to ZERO when signed out, folding the old
			// identity gate into the amount gate below.
			let amount: bigint;

			try {
				amount = await getSweepableVxpAmount();
			} catch (e: unknown) {
				console.warn('Playground VXP auto-deposit: balance/fee read failed', e);
				scheduleNext();

				return;
			}

			if (!alive || !playgroundNow()) {
				return;
			}

			if (amount <= ZERO) {
				scheduleNext();

				return;
			}

			inFlight = true;

			try {
				await depositCollateral({
					assetPrincipal: VXP_TOKEN.ledgerCanisterId,
					amount,
					domain: { ViciXp: null }
				});
			} catch (e: unknown) {
				console.warn('Playground VXP auto-deposit failed', e);
			} finally {
				inFlight = false;
			}

			if (!alive || !playgroundNow()) {
				return;
			}

			scheduleNext();
		};

		scheduleNext();

		return () => {
			alive = false;
			clearTimer();
			inFlight = false;
		};
	});
</script>
