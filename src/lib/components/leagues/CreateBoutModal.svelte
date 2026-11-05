<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { Search, X } from '@lucide/svelte/icons';
	import BottomSheet from '#lib/components/ui/BottomSheet.svelte';
	import { DAY_IN_MS } from '#lib/constants/app.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import {
		listChallengeableLeagues,
		listMyLeagues,
		proposeBattle,
		type LeagueWithRole
	} from '#lib/services/leagues.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import {
		BATTLE_TRASH_TALK_MAX_LENGTH,
		BATTLE_WAGER_DEFAULT,
		BATTLE_WAGER_MAX,
		BATTLE_WAGER_MIN,
		type BattleDoc,
		type BattleScope
	} from '#lib/types/battle.ts';
	import { isLeaguePubliclyListed, type LeagueDoc } from '#lib/types/league.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';

	/**
	 * Create-a-battle wizard — the multi-step "start a battle" sheet
	 * reachable from the Battles surface and from a league's own detail
	 * page (where `fromLeagueId` pins the challenger side).
	 *
	 * Steps (steps the caller sees collapse when the data is
	 * unambiguous):
	 *
	 *  1. Pick your league — only the leagues the caller owns or admins
	 *     can send a challenge (the satellite assert hard-rejects everyone
	 *     else). Auto-skipped when the caller owns/admins exactly one league
	 *     or when `fromLeagueId` pins the challenger; the empty state routes
	 *     to Leagues when they have none.
	 *  2. Opponent — a searchable list of challengeable leagues
	 *     (`listChallengeableLeagues`): public leagues plus the caller's
	 *     own memberships, minus the leagues the caller owns. The caller
	 *     filters by name and taps the opponent.
	 *  3. Scope — which calls count: all, or a single market category.
	 *  4. Wager — an optional VXP stake (0–500); 0 means no stake.
	 *  5. Trash-talk — an optional short message (brevity rewarded).
	 *  6. Duration — 7 / 14 / 30 days, mapped to the kickoff → settle
	 *     window the satellite stores.
	 *
	 * Wraps the same `proposeBattle` service the league-detail Challenge
	 * action uses, so the satellite contract is identical regardless of
	 * entry point.
	 */
	interface Props {
		isOpen: boolean;
		/**
		 * When set, pins the challenger side to this league and collapses
		 * the pick-your-league step — used by the league-detail entry point,
		 * where the caller is already acting on a specific league they own.
		 */
		fromLeagueId?: string;
		onClose: () => void;
		onProposed?: (battle: BattleDoc) => void;
	}

	const { isOpen, fromLeagueId, onClose, onProposed }: Props = $props();

	const DURATIONS = [7, 14, 30] as const;
	type Duration = (typeof DURATIONS)[number];

	// Scope options surfaced in the picker — `all` plus the two macro
	// narrowings the design highlights, labelled via the macro catalog.
	const SCOPE_OPTIONS: readonly { value: BattleScope; key: MessageKey }[] = [
		{ value: 'all', key: 'battles.create.scope_all' },
		{ value: 'sports', key: 'market.macro.sports' },
		{ value: 'economy', key: 'market.macro.economy' }
	];

	// Start as 'loading' so the first open shows the spinner immediately
	// rather than briefly flashing the form before data arrives.
	let loadState: 'loading' | 'ready' | 'error' = $state('loading');
	let hasLoaded = $state(false);
	let ownedLeagues: LeagueWithRole[] = $state([]);
	let challengeable: LeagueDoc[] = $state([]);

	let fromLeague: LeagueDoc | undefined = $state();
	let opponent: LeagueDoc | undefined = $state();
	let opponentSearch = $state('');
	let scope = $state<BattleScope>('all');
	let wager = $state<number>(BATTLE_WAGER_DEFAULT);
	let trashTalk = $state('');
	let duration = $state<Duration>(7);

	let submitting = $state(false);
	let submitError: MessageKey | null = $state(null);

	// Opponents are every challengeable league except the chosen
	// from-side (a league can't challenge itself), narrowed by the
	// case-insensitive name search.
	const opponentOptions = $derived.by(() => {
		const query = opponentSearch.trim().toLowerCase();

		return challengeable.filter(
			(league) =>
				league.id !== fromLeague?.id &&
				(query.length === 0 || league.name.toLowerCase().includes(query))
		);
	});

	const trashTalkRemaining = $derived(BATTLE_TRASH_TALK_MAX_LENGTH - trashTalk.length);

	// True once the load resolves a pinned `fromLeagueId` to a league the
	// caller actually owns — collapses the pick-your-league step.
	const isPinned = $derived(
		nonNullish(fromLeagueId) && ownedLeagues.some((owned) => owned.league.id === fromLeagueId)
	);

	// The challenger side after a load: a pinned league (league-detail
	// entry) wins; otherwise auto-select when the caller owns exactly one
	// league, else leave the picker open.
	const pickDefaultFromLeague = (): LeagueDoc | undefined => {
		const pinned = nonNullish(fromLeagueId)
			? ownedLeagues.find((owned) => owned.league.id === fromLeagueId)
			: undefined;

		return pinned?.league ?? (ownedLeagues.length === 1 ? ownedLeagues[0].league : undefined);
	};

	const canSend = $derived(
		!submitting && nonNullish(fromLeague) && nonNullish(opponent) && opponent.id !== fromLeague.id
	);

	// The wizard's actions dock in the sheet's non-scrolling footer (so the
	// CTA never gets clipped on short iOS viewports — same treatment as the
	// affiliation picker). Only the ready form state has docked actions; the
	// loading / error / no-leagues states keep their own short body buttons.
	const showFooter = $derived.by(() => loadState === 'ready' && ownedLeagues.length > 0);

	const load = async () => {
		loadState = 'loading';

		try {
			const [mine, opponents] = await Promise.all([listMyLeagues(), listChallengeableLeagues()]);
			ownedLeagues = mine.filter((m) => m.role === 'owner' || m.role === 'admin');
			challengeable = opponents;

			fromLeague = pickDefaultFromLeague();
			loadState = 'ready';
		} catch (err) {
			console.error('CreateBoutModal: load failed', err);
			loadState = 'error';
		}
	};

	// Defer the league fetch until the sheet actually opens; guard with
	// `hasLoaded` so reopening the sheet does not re-fire the request.
	$effect(() => {
		if (isOpen && !hasLoaded) {
			hasLoaded = true;
			void load();
		}
	});

	const reset = () => {
		fromLeague = pickDefaultFromLeague();
		opponent = undefined;
		opponentSearch = '';
		scope = 'all';
		wager = BATTLE_WAGER_DEFAULT;
		trashTalk = '';
		duration = 7;
		submitting = false;
		submitError = null;
	};

	const handleClose = () => {
		reset();
		onClose();
	};

	const goToLeagues = () => {
		handleClose();
		void goto(`${resolveAppPath(AppPath.Arena)}/leagues`);
	};

	const selectLeague = (league: LeagueDoc) => {
		fromLeague = league;
		// Clear any opponent picked under a previous "from" league so the
		// same-league guard can't be stale.
		opponent = undefined;
		opponentSearch = '';
	};

	const selectOpponent = (league: LeagueDoc) => {
		opponent = league;
	};

	const clearOpponent = () => {
		opponent = undefined;
		opponentSearch = '';
	};

	const handleSubmit = async (event?: Event) => {
		event?.preventDefault();

		if (!canSend || isNullish(fromLeague) || isNullish(opponent)) {
			return;
		}

		submitting = true;
		submitError = null;

		try {
			const battle = await proposeBattle({
				sideA: fromLeague.id,
				sideB: opponent.id,
				durationMs: duration * DAY_IN_MS,
				scope,
				wager,
				trashTalk
			});

			track({
				name: 'battle_proposed',
				battleId: battle.id,
				leagueId: fromLeague.id,
				label: scope
			});

			onProposed?.(battle);
			handleClose();
		} catch (err) {
			console.error('CreateBoutModal: proposeBattle failed', err);
			submitError = 'common.error.generic';
		} finally {
			submitting = false;
		}
	};
</script>

{#snippet boutFooter()}
	<div class="create-bout-foot">
		{#if nonNullish(submitError)}
			<p class="create-bout-error" role="alert">
				{t({ locale: $localeStore, key: submitError })}
			</p>
		{/if}

		{#if opponent}
			<!-- Real submit button linked to the form via the `form` attribute —
				 it lives in the sheet's non-scrolling footer (outside the <form>)
				 but keeps native submit semantics (Enter / implicit submission /
				 assistive tech). -->
			<button
				class="create-bout-btn is-primary"
				disabled={!canSend}
				form="create-bout-form"
				type="submit"
			>
				{submitting
					? t({ locale: $localeStore, key: 'leagues.battle.propose.submitting' })
					: `${t({
							locale: $localeStore,
							key: 'battles.create.send_to',
							params: { name: opponent.name }
						})} →`}
			</button>
		{/if}

		<button class="create-bout-btn is-ghost" onclick={handleClose} type="button">
			{t({ locale: $localeStore, key: 'battles.create.cancel' })}
		</button>
	</div>
{/snippet}

<BottomSheet footer={showFooter ? boutFooter : undefined} {isOpen} onClose={handleClose}>
	<div class="create-bout">
		<header class="create-bout-head">
			<h2>{t({ locale: $localeStore, key: 'battles.create.title' })}</h2>
			<button
				class="create-bout-close"
				aria-label={t({ locale: $localeStore, key: 'a11y.close' })}
				onclick={handleClose}
				type="button"
			>
				<X aria-hidden="true" size={16} strokeWidth={1.8} />
			</button>
		</header>

		{#if loadState === 'loading'}
			<p class="create-bout-status" aria-busy="true">
				{t({ locale: $localeStore, key: 'battles.create.loading' })}
			</p>
		{:else if loadState === 'error'}
			<p class="create-bout-error" role="alert">
				{t({ locale: $localeStore, key: 'common.error.generic' })}
			</p>
		{:else if ownedLeagues.length === 0}
			<!-- No owned leagues — you must admin a league to challenge. -->
			<p class="serif-italic create-bout-lede">
				{t({ locale: $localeStore, key: 'battles.create.empty_lede' })}
			</p>
			<p class="create-bout-body">
				{t({ locale: $localeStore, key: 'battles.create.empty_body' })}
			</p>
			<button class="create-bout-btn is-primary" onclick={goToLeagues} type="button">
				{t({ locale: $localeStore, key: 'battles.create.empty_cta' })} →
			</button>
			<button class="create-bout-btn is-ghost" onclick={handleClose} type="button">
				{t({ locale: $localeStore, key: 'battles.create.cancel' })}
			</button>
		{:else}
			<form id="create-bout-form" class="create-bout-form" onsubmit={handleSubmit}>
				<!-- Step 1 · Your league (the challenger side) -->
				{#if ownedLeagues.length > 1 && !isPinned}
					<fieldset class="create-bout-field">
						<legend class="allcaps create-bout-label">
							{t({ locale: $localeStore, key: 'battles.create.label_your_league' })}
						</legend>
						<div class="create-bout-league-row">
							{#each ownedLeagues as owned (owned.league.id)}
								<button
									class="create-bout-pill"
									class:is-active={fromLeague?.id === owned.league.id}
									onclick={() => selectLeague(owned.league)}
									type="button"
								>
									{owned.league.name}
								</button>
							{/each}
						</div>
					</fieldset>
				{:else if fromLeague}
					<!-- Exactly one owned league: it's auto-selected as the
						 challenger. Surface it read-only so the caller sees their
						 league IS in the battle — otherwise the step is invisible and
						 they look for their league in the opponent list (where it is
						 correctly excluded, since a league can't challenge itself). -->
					<div class="create-bout-field">
						<span class="allcaps create-bout-label">
							{t({ locale: $localeStore, key: 'battles.create.label_your_league' })}
						</span>
						<div class="create-bout-resolved">
							<div class="create-bout-resolved-text">
								<span class="create-bout-resolved-name">{fromLeague.name}</span>
							</div>
						</div>
					</div>
				{/if}

				{#if fromLeague}
					<!-- Step 2 · Opponent (searchable challengeable-league picker) -->
					<div class="create-bout-field">
						<span class="allcaps create-bout-label">
							{t({ locale: $localeStore, key: 'battles.create.label_opponent' })}
						</span>

						{#if !opponent}
							<div class="create-bout-search">
								<Search
									class="create-bout-search-icon"
									aria-hidden="true"
									size={15}
									strokeWidth={1.8}
								/>
								<input
									class="create-bout-input create-bout-search-input"
									aria-label={t({
										locale: $localeStore,
										key: 'battles.create.opponent_search_label'
									})}
									autocapitalize="none"
									autocomplete="off"
									placeholder={t({
										locale: $localeStore,
										key: 'battles.create.opponent_search_placeholder'
									})}
									spellcheck="false"
									type="text"
									bind:value={opponentSearch}
								/>
							</div>

							{#if challengeable.length === 0}
								<p class="create-bout-hint">
									{t({ locale: $localeStore, key: 'battles.create.opponent_empty' })}
								</p>
							{:else if opponentOptions.length === 0}
								<p class="create-bout-hint">
									{t({ locale: $localeStore, key: 'battles.create.opponent_no_match' })}
								</p>
							{:else}
								<ul class="create-bout-opponent-list">
									{#each opponentOptions as league (league.id)}
										<li>
											<button
												class="create-bout-opponent"
												onclick={() => selectOpponent(league)}
												type="button"
											>
												<span class="create-bout-opponent-name">{league.name}</span>
												{#if !isLeaguePubliclyListed(league)}
													<span class="allcaps create-bout-opponent-tag">
														{t({ locale: $localeStore, key: 'battles.create.opponent_private' })}
													</span>
												{/if}
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						{:else}
							<div class="create-bout-resolved">
								<div class="create-bout-resolved-text">
									<span class="allcaps create-bout-resolved-eyebrow">
										{t({ locale: $localeStore, key: 'leagues.battle.propose.opponent_resolved' })}
									</span>
									<span class="create-bout-resolved-name">{opponent.name}</span>
								</div>
								<button class="create-bout-change" onclick={clearOpponent} type="button">
									{t({ locale: $localeStore, key: 'battles.create.change' })}
								</button>
							</div>
						{/if}
					</div>

					{#if opponent}
						<!-- Step 3 · Scope -->
						<fieldset class="create-bout-field">
							<legend class="allcaps create-bout-label">
								{t({ locale: $localeStore, key: 'battles.create.label_scope' })}
							</legend>
							<div class="create-bout-duration-row">
								{#each SCOPE_OPTIONS as option (option.value)}
									<button
										class="create-bout-pill"
										class:is-active={scope === option.value}
										aria-pressed={scope === option.value}
										onclick={() => (scope = option.value)}
										type="button"
									>
										{t({ locale: $localeStore, key: option.key })}
									</button>
								{/each}
							</div>
						</fieldset>

						<!-- Step 4 · Wager (optional) -->
						<div class="create-bout-field">
							<div class="create-bout-wager-head">
								<span class="allcaps create-bout-label">
									{t({ locale: $localeStore, key: 'battles.create.label_wager' })}
								</span>
								<span class="num create-bout-wager-value">
									{wager === BATTLE_WAGER_MIN
										? t({ locale: $localeStore, key: 'battles.create.wager_none' })
										: t({
												locale: $localeStore,
												key: 'battles.create.wager_value',
												params: { amount: wager }
											})}
								</span>
							</div>
							<input
								class="create-bout-slider"
								aria-label={t({ locale: $localeStore, key: 'battles.create.label_wager' })}
								max={BATTLE_WAGER_MAX}
								min={BATTLE_WAGER_MIN}
								oninput={(event) => (wager = Number(event.currentTarget.value))}
								step="10"
								type="range"
								value={wager}
							/>
						</div>

						<!-- Step 5 · Trash-talk (optional) -->
						<div class="create-bout-field">
							<label class="allcaps create-bout-label" for="create-bout-trash-talk">
								{t({ locale: $localeStore, key: 'battles.create.label_trash_talk' })}
							</label>
							<input
								id="create-bout-trash-talk"
								class="create-bout-input"
								autocomplete="off"
								maxlength={BATTLE_TRASH_TALK_MAX_LENGTH}
								placeholder={t({
									locale: $localeStore,
									key: 'battles.create.trash_talk_placeholder'
								})}
								type="text"
								bind:value={trashTalk}
							/>
							<p class="create-bout-hint">
								{t({ locale: $localeStore, key: 'battles.create.trash_talk_hint' })} ·
								<span class="num">{trashTalkRemaining}</span>
							</p>
						</div>

						<!-- Step 6 · Duration -->
						<fieldset class="create-bout-field">
							<legend class="allcaps create-bout-label">
								{t({ locale: $localeStore, key: 'battles.create.label_duration' })}
							</legend>
							<div class="create-bout-duration-row">
								{#each DURATIONS as days (days)}
									<button
										class="create-bout-pill"
										class:is-active={duration === days}
										onclick={() => (duration = days)}
										type="button"
									>
										{t({
											locale: $localeStore,
											key: 'leagues.challenge.duration_days',
											params: { count: days }
										})}
									</button>
								{/each}
							</div>
						</fieldset>
					{/if}
				{/if}
			</form>
		{/if}
	</div>
</BottomSheet>

<style lang="postcss">
	.create-bout {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.create-bout-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.create-bout-head h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--t-18, 1.1rem);
		color: var(--text-base);
	}

	.create-bout-close {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.35rem;
		color: var(--text-muted);
		background: transparent;
		border: 0;
		cursor: pointer;
	}

	.create-bout-status,
	.create-bout-error {
		margin: 0;
		font-size: var(--t-13);
	}

	.create-bout-status {
		color: var(--text-muted);
	}

	.create-bout-error {
		color: var(--no);
	}

	.create-bout-lede {
		margin: 0;
		font-size: var(--t-15, 0.95rem);
		color: var(--laurel);
	}

	.create-bout-body {
		margin: 0;
		font-size: var(--t-13);
		line-height: 1.5;
		color: var(--text-muted);
	}

	.create-bout-form {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.create-bout-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}

	.create-bout-label {
		font-size: var(--t-11);
		color: var(--text-muted);
	}

	.create-bout-league-row,
	.create-bout-duration-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.create-bout-duration-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
	}

	.create-bout-pill {
		appearance: none;
		flex: 1 1 auto;
		padding: 0.55rem 0.7rem;
		font: inherit;
		font-size: var(--t-12);
		font-weight: 600;
		color: var(--text-muted);
		background: color-mix(in srgb, var(--bg-surface) 90%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		cursor: pointer;
		transition:
			background 140ms ease,
			border-color 140ms ease,
			color 140ms ease;
	}

	.create-bout-pill.is-active {
		color: var(--laurel);
		background: color-mix(in srgb, var(--laurel) 12%, transparent);
		border-color: color-mix(in srgb, var(--laurel) 45%, var(--border-base));
	}

	.create-bout-input {
		appearance: none;
		padding: 0.7rem 0.85rem;
		font: inherit;
		font-size: var(--t-14);
		color: var(--text-base);
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		min-width: 0;
	}

	.create-bout-search {
		position: relative;
		display: flex;
		align-items: center;
	}

	.create-bout-search :global(.create-bout-search-icon) {
		position: absolute;
		left: 0.7rem;
		color: var(--text-muted);
		pointer-events: none;
	}

	.create-bout-search-input {
		flex: 1 1 auto;
		padding-left: 2.1rem;
	}

	.create-bout-opponent-list {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin: 0.1rem 0 0;
		padding: 0;
		list-style: none;
		/* No inner max-height / overflow: the sheet body is the single
		 * scroller, so the whole opponent list is reachable by scrolling.
		 * A nested scroll region traps the wheel/touch on iOS and hides the
		 * lower leagues (#552). */
	}

	.create-bout-opponent {
		appearance: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		padding: 0.6rem 0.75rem;
		font: inherit;
		text-align: left;
		color: var(--text-base);
		background: color-mix(in srgb, var(--bg-surface) 90%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		cursor: pointer;
		transition:
			background 140ms ease,
			border-color 140ms ease;
	}

	.create-bout-opponent:hover {
		border-color: color-mix(in srgb, var(--laurel) 45%, var(--border-base));
		background: color-mix(in srgb, var(--laurel) 8%, transparent);
	}

	.create-bout-opponent-name {
		font-size: var(--t-14);
		font-weight: 600;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.create-bout-opponent-tag {
		flex-shrink: 0;
		font-size: var(--t-10);
		color: var(--text-muted);
		letter-spacing: var(--tracking-allcaps);
	}

	.create-bout-wager-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.create-bout-wager-value {
		font-size: var(--t-13);
		font-weight: 700;
		color: var(--laurel);
	}

	.create-bout-slider {
		width: 100%;
		accent-color: var(--laurel);
		cursor: pointer;
	}

	.create-bout-hint {
		margin: 0.1rem 0 0;
		font-size: var(--t-11);
		line-height: 1.4;
		color: var(--text-muted);
	}

	.create-bout-resolved {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.55rem 0.75rem;
		background: color-mix(in srgb, var(--laurel) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--laurel) 25%, var(--border-base));
		border-radius: var(--r-12);
	}

	.create-bout-resolved-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.create-bout-resolved-eyebrow {
		font-size: var(--t-10);
		color: var(--text-muted);
		letter-spacing: var(--tracking-allcaps);
	}

	.create-bout-resolved-name {
		font-family: var(--font-display);
		font-size: var(--t-14);
		font-weight: 600;
		color: var(--text-base);
	}

	.create-bout-change {
		appearance: none;
		flex-shrink: 0;
		padding: 0;
		font: inherit;
		font-size: var(--t-12);
		color: var(--text-muted);
		background: none;
		border: 0;
		cursor: pointer;
		text-decoration: underline;
	}

	.create-bout-foot {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.create-bout-btn {
		appearance: none;
		padding: 0.8rem 1.1rem;
		font: inherit;
		font-size: var(--t-13);
		font-weight: 700;
		border-radius: var(--r-pill);
		cursor: pointer;
		text-align: center;
	}

	.create-bout-btn.is-primary {
		color: var(--text-on-accent, #fff);
		background: var(--laurel);
		border: 1px solid var(--laurel);
	}

	.create-bout-btn.is-primary:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.create-bout-btn.is-ghost {
		color: var(--text-muted);
		background: none;
		border: 1px solid var(--border-base);
	}
</style>
