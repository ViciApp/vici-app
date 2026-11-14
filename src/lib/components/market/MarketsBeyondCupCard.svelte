<script lang="ts">
	import { Check, ChevronDown, ChevronRight, Lock } from '@lucide/svelte';
	import { slide } from 'svelte/transition';
	import {
		classificationTags,
		MACRO_IDS,
		type MacroId
	} from '#lib/constants/market-taxonomy.constants.ts';
	import { decisiveSettledCount } from '#lib/derived/resolved-positions.derived.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { userStore } from '#lib/stores/user.store.ts';
	import type { Market } from '#lib/types/market.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { categoryLabel } from '#lib/utils/market-tags.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	/**
	 * "Beyond the Cup" skill gate. During the World-Cup focus the Markets board
	 * surfaces only the World-Cup category; every other category stays locked
	 * behind a calibrated-accuracy goal. This card sits high on the board as the
	 * unlock motivator (not a waitlist; a target): it shows the viewer's
	 * calibrated accuracy and a progress bar toward {@link UNLOCK_ACC}, and
	 * expands to preview the locked categories.
	 *
	 * The gate is EARNED, not optimistic: it reads the viewer's *real* decisive
	 * win-rate (`profile.accuracy`, a 0..100 figure that is `0` until calls
	 * settle), never the empty-state 100% that own-stat surfaces show, and
	 * requires both a minimum sample of decisive calls
	 * ({@link BEYOND_CUP_MIN_CALLS}) and the accuracy threshold. A brand-new
	 * user therefore reads LOCKED at their real 0%, so the skill gate can't be
	 * unlocked before any skill is shown.
	 *
	 * `BEYOND_CUP_MIN_CALLS` is a dedicated gate (no app-wide lifetime min-calls
	 * display constant exists: the leaderboard's `MIN_CALLS_FOR_RANK` is 50 and
	 * the monthly award's `MONTHLY_MIN_CALLS` is month-scoped, both wrong here).
	 *
	 * Locked categories = the taxonomy macro board. World Cup lives under the
	 * `sports` macro with a `world-cup` free tag; the board's WC focus surfaces
	 * only markets carrying that free tag, and this gate previews the full macro
	 * board that unlocking opens.
	 */

	interface Props {
		/** All known markets, used to count the open non-World-Cup lines. */
		markets: Market[];
		/** Per-market tag lookup (`market.id` → stored tags), from `$marketTags`. */
		tagsByMarket: Record<string, string[]>;
		/** Whether tag metadata has loaded: the count is `0` until it has. */
		tagsInitialized: boolean;
	}

	const { markets, tagsByMarket, tagsInitialized }: Props = $props();

	/** Calibrated-accuracy threshold (0..1) to unlock the non-World-Cup board. */
	const UNLOCK_ACC = 0.75;

	/**
	 * Minimum decisive (won/lost) settled calls before the gate can unlock.
	 * Below this the win-rate is too noisy to certify skill (a single 1/1
	 * would otherwise clear the bar), so the gate stays locked regardless of
	 * the percentage.
	 */
	const BEYOND_CUP_MIN_CALLS = 30;

	let open = $state(false);

	// Real decisive win-rate (0..100), NOT the optimistic empty-state 100%: the
	// gate must be earned, so a user with no settled calls reads their true 0%.
	const accuracyPctRaw = $derived($userStore.profile?.accuracy ?? 0);
	const settledCount = $derived($decisiveSettledCount);

	// Headline percent and remaining points are both derived from the same raw
	// value the lock state uses, so the headline can never read "75% / 0 to go"
	// while still locked (74.6 → rounds to 75 but is below the 0.75 bar). The
	// percent rounds DOWN so it never overshoots the unrounded comparison.
	const target = $derived(Math.round(UNLOCK_ACC * 100));
	const pct = $derived(Math.floor(accuracyPctRaw));
	const unlocked = $derived(
		settledCount >= BEYOND_CUP_MIN_CALLS && accuracyPctRaw / 100 >= UNLOCK_ACC
	);
	const progress = $derived(Math.max(0, Math.min(1, accuracyPctRaw / 100 / UNLOCK_ACC)));
	const remaining = $derived(Math.max(0, target - pct));

	// Locked categories: the full macro board that unlocking opens.
	const lockedCategories = $derived<MacroId[]>([...MACRO_IDS]);

	// What unlocking opens, counted in MARKETS (not categories): open lines that
	// aren't World-Cup (no `world-cup` free tag). `0` until tags load so the
	// headline never overcounts.
	const nonWcOpenMarketsCount = $derived(
		tagsInitialized
			? markets.filter(
					(market) =>
						market.status === 'Open' &&
						!classificationTags(tagsByMarket[market.id] ?? []).includes('world-cup')
				).length
			: 0
	);

	const toggle = () => (open = !open);
</script>

<div class="beyond-wrap">
	<button class="card-surface beyond" aria-expanded={open} onclick={toggle} type="button">
		<!-- Compact header: always visible -->
		<div style="align-items: center; gap: 12px;" class="row between">
			<div style="gap: 10px; align-items: center; min-width: 0;" class="row">
				<span class="beyond-icon" class:unlocked aria-hidden="true">
					{#if unlocked}
						<Check size={15} />
					{:else}
						<Lock size={15} />
					{/if}
				</span>
				<div style="gap: 2px; min-width: 0;" class="col">
					<span class="beyond-eyebrow eyebrow-xs">
						{t({ locale: $localeStore, key: 'markets.beyond.eyebrow' })}
					</span>
					<span class="beyond-status t-eyebrow">
						{#if unlocked}
							{t({
								locale: $localeStore,
								key: 'markets.beyond.ready',
								params: { count: nonWcOpenMarketsCount }
							})}
						{:else}
							{t({
								locale: $localeStore,
								key: 'markets.beyond.unlock_at',
								params: { pct: target }
							})}
						{/if}
					</span>
				</div>
			</div>
			<div style="gap: 8px; align-items: center; flex: 0 0 auto;" class="row">
				<span class="beyond-pct num t-body-sm fw-600" class:unlocked>{pct}%</span>
				<span class="beyond-chev" class:open aria-hidden="true">
					<ChevronDown size={16} />
				</span>
			</div>
		</div>

		<!-- Thin progress bar: always visible -->
		<div class="beyond-track">
			<div
				style:width={`${progress * 100}%`}
				class="beyond-fill"
				class:reduced={prefersReducedMotion()}
				class:unlocked
			></div>
		</div>

		<!-- Expanded detail: the unlock copy + the locked category tiles -->
		{#if open}
			<div transition:slide={{ duration: prefersReducedMotion() ? 0 : 200 }}>
				<p class="beyond-copy dim t-body-sm">
					{#if unlocked}
						{t({ locale: $localeStore, key: 'markets.beyond.unlocked_copy' })}
					{:else}
						{t({
							locale: $localeStore,
							key: 'markets.beyond.locked_copy',
							params: { pct: target, remaining }
						})}
					{/if}
				</p>
				<div class="beyond-tiles">
					{#each lockedCategories as category (category)}
						<div class="beyond-tile row between">
							<span class="beyond-tile-label t-body-sm fw-600" class:unlocked>
								{categoryLabel({ category, variant: 'full', locale: $localeStore })}
							</span>
							<span class="beyond-tile-icon" aria-hidden="true">
								{#if unlocked}
									<ChevronRight size={14} />
								{:else}
									<Lock size={14} />
								{/if}
							</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</button>
</div>

<style lang="postcss">
	.beyond-wrap {
		padding: 0 20px 16px;
	}

	.beyond {
		width: 100%;
		text-align: left;
		cursor: pointer;
		gap: 0;
		appearance: none;
		font: inherit;
		color: var(--text-base);
	}

	.beyond-icon {
		width: 30px;
		height: 30px;
		flex: 0 0 30px;
		border-radius: 9px;
		display: grid;
		place-items: center;
		border: 1px solid var(--border-strong);
		background: var(--bg-base);
		color: var(--fg-dim);
	}

	.beyond-icon.unlocked {
		color: var(--yes);
	}

	.beyond-eyebrow {
		white-space: nowrap;
		letter-spacing: 0.12em;
		color: var(--fg-dim);
	}

	.beyond-status {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--fg-dim);
	}

	.beyond-pct {
		color: var(--text-base);
	}

	.beyond-pct.unlocked {
		color: var(--yes);
	}

	.beyond-chev {
		color: var(--text-muted);
		display: grid;
		transition: transform 0.2s ease;
	}

	.beyond-chev.open {
		transform: rotate(180deg);
	}

	.beyond-track {
		height: 5px;
		border-radius: 999px;
		background: var(--bg-base);
		overflow: hidden;
		border: 1px solid var(--border-base);
		margin-top: 12px;
	}

	.beyond-fill {
		height: 100%;
		border-radius: 999px;
		background: var(--accent);
		transition: width 0.4s ease;
	}

	.beyond-fill.unlocked {
		background: var(--yes);
	}

	.beyond-fill.reduced {
		transition: none;
	}

	.beyond-copy {
		margin-top: 14px;
		margin-bottom: 0;
		line-height: 1.5;
		color: var(--fg-dim);
	}

	.beyond-tiles {
		margin-top: 14px;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	.beyond-tile {
		padding: 11px 12px;
		border-radius: 12px;
		background: var(--bg-base);
		border: 1px solid var(--border-strong);
		align-items: center;
	}

	.beyond-tile-label {
		color: var(--fg-dim);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.beyond-tile-label.unlocked {
		color: var(--text-base);
	}

	.beyond-tile-icon {
		color: var(--text-muted);
		display: grid;
		flex: 0 0 auto;
	}

	@media (prefers-reduced-motion: reduce) {
		.beyond-fill,
		.beyond-chev {
			transition: none;
		}
	}
</style>
