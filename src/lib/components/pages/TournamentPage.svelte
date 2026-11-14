<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import ScreenHeader from '#lib/components/layout/ScreenHeader.svelte';
	import { DAY_IN_MS, EMPTY_VALUE, MINUTE_IN_MS } from '#lib/constants/app.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import {
		claimTournamentPrize,
		getCurrentTournament,
		resolveTournamentRound,
		triggerTournamentDraw
	} from '#lib/services/tournament.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import {
		TOURNAMENT_BRACKET_SIZE,
		TOURNAMENT_PRIZE_TIERS,
		TOURNAMENT_ROUNDS,
		type TournamentDoc,
		type TournamentMatchDoc,
		type TournamentRound
	} from '#lib/types/tournament.ts';
	import { formatIsoDateUtc, formatProbability } from '#lib/utils/format.utils.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { monthAnchorFromMs } from '#lib/utils/month-anchor.utils.ts';
	import { goBack, resolveAppPath } from '#lib/utils/nav.utils.ts';

	/**
	 * Tournament detail: the `TournamentBattleDetail` surface.
	 *
	 * Fires `triggerTournamentDraw` for the current month on mount as
	 * a fire-and-forget (idempotent via the satellite's doc-key
	 * collision), then reads `getCurrentTournament` to render the
	 * bracket. The draw refuses with `insufficient_leagues` when
	 * fewer than 16 leagues exist; the FE renders that as a "waiting
	 * on more leagues" hint instead of an error.
	 *
	 * After the draw + read, the page walks forward through the
	 * bracket and fires `resolveTournamentRound` for each round whose
	 * `endMs <= now` (idempotent via the match doc's `winnerLeagueId`
	 * write-once invariant). When the tournament flips to
	 * `concluded` the page also fires `claimTournamentPrize` to
	 * credit the caller's VXP if their league finished top-3.
	 */

	let tournament = $state<TournamentDoc | null>(null);
	let matches = $state<TournamentMatchDoc[]>([]);
	let loaded = $state(false);
	let drawHint = $state<'available_leagues' | null>(null);
	let availableLeagues = $state<number>(0);
	let prizeClaim = $state<{
		awardsCreated: number;
		totalVxpCredited: number;
	} | null>(null);

	// Re-tick every minute so the days-left countdown + the "LIVE"
	// branch refresh without a full re-render of the bracket.
	let nowMs = $state(Date.now());
	$effect(() => {
		const handle = setInterval(() => {
			nowMs = Date.now();
		}, MINUTE_IN_MS);

		return () => clearInterval(handle);
	});

	/**
	 * The current "in-flight" round: the lowest-index round whose
	 * `endMs` is in the future and at least one match still unresolved.
	 * Used to tag the first match in that round as `LIVE`.
	 */
	const currentRound = $derived.by((): TournamentRound | null => {
		for (const round of TOURNAMENT_ROUNDS) {
			const ms = matches.filter((m) => m.round === round);

			if (ms.length > 0) {
				const allDone = ms.every((m) => nonNullish(m.winnerLeagueId));
				const someOpen = ms.some((m) => m.endMs > nowMs);

				if (!allDone && someOpen) {
					return round;
				}
			}
		}

		return null;
	});

	const daysLeft = $derived.by((): number | null => {
		if (isNullish(currentRound)) {
			return null;
		}

		const liveMatch = matchesByRound[currentRound]?.[0];

		if (isNullish(liveMatch)) {
			return null;
		}

		const deltaMs = liveMatch.endMs - nowMs;

		if (deltaMs <= 0) {
			return 0;
		}

		return Math.ceil(deltaMs / DAY_IN_MS);
	});

	const matchesByRound = $derived.by((): Record<TournamentRound, TournamentMatchDoc[]> => {
		const grouped: Record<TournamentRound, TournamentMatchDoc[]> = {
			r1: [],
			quarter: [],
			semifinal: [],
			final: []
		};

		for (const m of matches) {
			grouped[m.round].push(m);
		}

		return grouped;
	});

	const roundLabelKey = (round: TournamentRound): MessageKey =>
		`tournament.round.${round.replace('r1', 'round1')}` as MessageKey;

	const fmtAccuracy = (value: number | null): string =>
		isNullish(value) ? EMPTY_VALUE : formatProbability(value);

	/**
	 * Rank glyph for a prize-tier place. Brand: no emoji medals;
	 * tabular numeral on a laurel-toned tile carries the same rank
	 * signal without the pictograph. See
	 * `docs/ai/frontend/brand.md §2.3`.
	 */
	const placeGlyph = (place: 1 | 2 | 3): string => `${place}`;

	const refresh = async () => {
		try {
			const { tournament: t_, matches: m_ } = await getCurrentTournament();
			tournament = t_;
			matches = m_;
		} catch {
			// Defensive: the page renders the empty state on read failure.
			tournament = null;
			matches = [];
		} finally {
			loaded = true;
		}
	};

	const tryDraw = async () => {
		try {
			const result = await triggerTournamentDraw({
				monthAnchor: monthAnchorFromMs(Date.now())
			});

			if (!result.ok && result.reason === 'insufficient_leagues') {
				drawHint = 'available_leagues';
				availableLeagues = result.availableLeagues ?? 0;
			}

			// On success or `already_drawn`, read the now-current tournament.
			await refresh();
		} catch {
			await refresh();
		}
	};

	/**
	 * Walk forward through the bracket and fire round resolution for
	 * every round whose window has closed. The endpoint is idempotent
	 * (the assert's `winnerLeagueId` write-once rule rejects re-runs
	 * cleanly), so this is safe to fire on every page mount.
	 *
	 * Returns whether any round actually settled during this call:
	 * used by the caller to decide if a refresh is needed.
	 */
	const tryResolveRounds = async (): Promise<boolean> => {
		if (isNullish(tournament)) {
			return false;
		}

		const nowMs = Date.now();
		let settledAny = false;

		// Walk forward; we short-circuit on the first round that hasn't
		// closed (`endMs > now`) or that the satellite refuses. Empty
		// rounds and already-fully-resolved rounds fall through without
		// an explicit `continue`.
		let stop = false;

		for (const round of TOURNAMENT_ROUNDS) {
			if (stop) {
				break;
			}

			const roundMatches = matchesByRound[round];
			const closed = roundMatches.length > 0 && roundMatches[0].endMs <= nowMs;
			const hasOpen = roundMatches.some((m) => isNullish(m.winnerLeagueId));

			if (closed && hasOpen) {
				try {
					const result = await resolveTournamentRound({
						tournamentId: tournament.id,
						round
					});

					if (result.ok && (result.matchesResolved ?? 0) > 0) {
						settledAny = true;
					}

					// If this round refuses with `previous_round_not_resolved`
					// it means an earlier round's resolution write hasn't
					// been picked up yet; stop and let the next page mount
					// catch up.
					if (!result.ok) {
						stop = true;
					}
				} catch {
					stop = true;
				}
			} else if (roundMatches.length === 0 || roundMatches[0].endMs > nowMs) {
				// No matches yet or the next round hasn't closed: nothing
				// past this point can resolve either.
				stop = !hasOpen || roundMatches[0].endMs > nowMs;
			}
		}

		return settledAny;
	};

	/**
	 * Fire the prize-claim endpoint for the current tournament if it
	 * has concluded. Idempotent: a second call returns
	 * `awardsAlreadyClaimed > 0` and we show no banner. The first
	 * successful claim populates the `prizeClaim` banner with the
	 * VXP credited.
	 */
	const tryClaimPrize = async () => {
		if (isNullish(tournament) || tournament.state !== 'concluded') {
			return;
		}

		try {
			const result = await claimTournamentPrize({ tournamentId: tournament.id });

			if (result.ok && (result.awardsCreated ?? 0) > 0) {
				prizeClaim = {
					awardsCreated: result.awardsCreated ?? 0,
					totalVxpCredited: result.totalVxpCredited ?? 0
				};
			}
		} catch {
			// Silent: the claim is a nice-to-have; failure shouldn't
			// disrupt the bracket render.
		}
	};

	onMount(async () => {
		await tryDraw();

		// Walk the bracket forward; if anything settled, re-read so the
		// UI shows the new winners + accuracies + propagated slots.
		const settled = await tryResolveRounds();

		if (settled) {
			await refresh();
		}

		await tryClaimPrize();
	});
</script>

<div class="tournament-page">
	<ScreenHeader
		back={{
			label: t({ locale: $localeStore, key: 'tournament.back' }),
			onBack: () => goBack(resolveAppPath(AppPath.Arena))
		}}
		title={t({ locale: $localeStore, key: 'tournament.title' })}
	/>

	<section class="tournament-hero">
		<!--
			When a round is in
			flight we surface the current round tag + days-left
			countdown along the top, and a "bracket" headline with
			the live-leagues-remaining sub. The eyebrow is the muted
			"MONTHLY TOURNAMENT" label when nothing is in flight.
		-->
		<div class="tournament-hero-head">
			{#if nonNullish(currentRound)}
				<span class="tournament-round-tag allcaps">
					{t({ locale: $localeStore, key: roundLabelKey(currentRound) })}
				</span>
				{#if nonNullish(daysLeft)}
					<span class="tournament-days-left num allcaps">
						{t({
							locale: $localeStore,
							key: 'tournament.days_left',
							params: { count: daysLeft }
						})}
					</span>
				{/if}
			{:else}
				<span class="allcaps tournament-tag">
					{t({ locale: $localeStore, key: 'tournament.eyebrow' })}
				</span>
			{/if}
		</div>
		<h1 class="tournament-headline">
			{t({
				locale: $localeStore,
				key: 'tournament.headline',
				params: { size: tournament?.bracketSize ?? TOURNAMENT_BRACKET_SIZE }
			})}
		</h1>
		<p class="tournament-sub">
			{t({ locale: $localeStore, key: 'tournament.sub' })}
		</p>
	</section>

	{#if nonNullish(prizeClaim)}
		<aside class="tournament-prize-claim">
			<p class="tournament-prize-claim-eyebrow allcaps">
				{t({ locale: $localeStore, key: 'tournament.prize_claim_eyebrow' })}
			</p>
			<p class="tournament-prize-claim-body">
				{t({
					locale: $localeStore,
					key: 'tournament.prize_claim_body',
					params: { amount: prizeClaim.totalVxpCredited.toLocaleString('en-US') }
				})}
			</p>
			<button
				class="tournament-prize-claim-dismiss"
				onclick={() => (prizeClaim = null)}
				type="button"
			>
				{t({ locale: $localeStore, key: 'tournament.prize_claim_dismiss' })}
			</button>
		</aside>
	{/if}

	<section class="tournament-section">
		<h2 class="eyebrow tournament-section-eyebrow">
			{t({ locale: $localeStore, key: 'tournament.bracket_eyebrow' })}
		</h2>

		{#if !loaded}
			<div class="tournament-pending">
				<p>{t({ locale: $localeStore, key: 'tournament.loading' })}</p>
			</div>
		{:else if isNullish(tournament)}
			<div class="tournament-pending">
				<p>
					{#if drawHint === 'available_leagues'}
						{t({
							locale: $localeStore,
							key: 'tournament.waiting_leagues',
							params: { available: availableLeagues, required: 16 }
						})}
					{:else}
						{t({ locale: $localeStore, key: 'tournament.bracket_pending' })}
					{/if}
				</p>
			</div>
		{:else}
			<div class="tournament-bracket">
				{#each TOURNAMENT_ROUNDS as round (round)}
					{@const roundMatches = matchesByRound[round]}
					<div class="tournament-round">
						<div class="tournament-round-eyebrow">
							{t({ locale: $localeStore, key: roundLabelKey(round) })}
						</div>
						<div class="tournament-round-matches">
							{#each roundMatches as match, matchIdx (match.index)}
								{@const concluded = nonNullish(match.winnerLeagueId)}
								{@const isLive = !concluded && matchIdx === 0 && round === currentRound}
								<div class="tournament-match" class:is-concluded={concluded} class:is-live={isLive}>
									<div
										class="tournament-team"
										class:is-loser={concluded && match.winnerLeagueId !== match.fromLeagueId}
										class:is-winner={concluded && match.winnerLeagueId === match.fromLeagueId}
									>
										<span class="tournament-team-name">{match.fromLeagueId ?? 'TBD'}</span>
										<span class="tournament-team-acc num">{fmtAccuracy(match.fromAcc)}</span>
									</div>
									<div
										class="tournament-team"
										class:is-loser={concluded && match.winnerLeagueId !== match.toLeagueId}
										class:is-winner={concluded && match.winnerLeagueId === match.toLeagueId}
									>
										<span class="tournament-team-name">{match.toLeagueId ?? 'TBD'}</span>
										<span class="tournament-team-acc num">{fmtAccuracy(match.toAcc)}</span>
									</div>
									<div class="tournament-match-meta num">
										{#if concluded}
											<span class="tournament-match-date"
												>{formatIsoDateUtc({ timestampMs: match.endMs })}</span
											>
											<span class="tournament-match-winner">
												{match.winnerLeagueId} →
											</span>
										{:else if isLive}
											<span class="tournament-match-live allcaps">
												{t({
													locale: $localeStore,
													key: 'tournament.match.live',
													params: { date: formatIsoDateUtc({ timestampMs: match.endMs }) }
												})}
											</span>
										{:else}
											<span class="tournament-match-upcoming allcaps">
												{t({
													locale: $localeStore,
													key: 'tournament.match.upcoming',
													params: { date: formatIsoDateUtc({ timestampMs: match.endMs }) }
												})}
											</span>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section class="tournament-section">
		<h2 class="eyebrow tournament-section-eyebrow">
			{t({ locale: $localeStore, key: 'tournament.prizes_eyebrow' })}
		</h2>
		<ul class="tournament-prizes">
			{#each TOURNAMENT_PRIZE_TIERS as tier (tier.place)}
				<li
					class="tournament-prize"
					class:is-bronze={tier.place === 3}
					class:is-gold={tier.place === 1}
					class:is-silver={tier.place === 2}
				>
					<span class="tournament-prize-place" aria-hidden="true">{placeGlyph(tier.place)}</span>
					<div class="tournament-prize-text">
						<span class="tournament-prize-label">
							{t({
								locale: $localeStore,
								key: `tournament.prize.place_${tier.place}`
							})}
						</span>
						<span class="num allcaps tournament-prize-sticker">
							{t({ locale: $localeStore, key: 'tournament.prize.sticker_sub' })}
						</span>
					</div>
					<span class="num tournament-prize-amount">+{tier.vxp.toLocaleString('en-US')}</span>
				</li>
			{/each}
		</ul>
	</section>
</div>

<style lang="postcss">
	.tournament-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0 1.25rem 6rem;
	}

	/* Hero: top-down purple fade:
	   `linear-gradient(180deg, rgba(180,156,255,0.10), transparent 70%)`
	   over `var(--bg-surface)`. */
	.tournament-hero {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1.2rem 1.1rem;
		background:
			linear-gradient(180deg, color-mix(in srgb, #b49cff 14%, transparent) 0%, transparent 70%),
			var(--bg-surface);
		border: 1px solid color-mix(in srgb, #b49cff 30%, var(--border-base));
		border-radius: var(--r-12);
	}

	.tournament-tag {
		font-size: var(--t-10);
		letter-spacing: var(--tracking-allcaps);
		padding: 0.15rem 0.55rem;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, #b49cff 18%, transparent);
		color: #b49cff;
		align-self: flex-start;
	}

	.tournament-headline {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--t-24, 1.5rem);
		font-weight: 600;
		line-height: 1.15;
		color: var(--text-base);
	}

	.tournament-sub {
		margin: 0;
		font-size: var(--t-13);
		line-height: 1.5;
		color: var(--text-muted);
	}

	.tournament-section {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.tournament-section-eyebrow {
		margin: 0;
		color: var(--text-muted);
	}

	.tournament-pending {
		padding: 1rem 1.1rem;
		font-size: var(--t-13);
		line-height: 1.5;
		color: var(--text-muted);
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px dashed var(--border-base);
		border-radius: var(--r-12);
	}

	.tournament-bracket {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.tournament-round {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.tournament-round-eyebrow {
		font-size: var(--t-11);
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.tournament-round-matches {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.tournament-match {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.65rem 0.85rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.tournament-match.is-concluded {
		border-color: color-mix(in srgb, var(--laurel) 35%, var(--border-base));
	}

	.tournament-team {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: var(--t-13);
	}

	.tournament-team.is-winner {
		color: var(--laurel);
		font-weight: 600;
	}

	.tournament-team.is-loser {
		color: var(--text-muted);
	}

	.tournament-team-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tournament-team-acc {
		font-weight: 600;
	}

	.tournament-match-meta {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.4rem;
		padding-top: 0.2rem;
		font-size: var(--t-10);
		letter-spacing: 0.1em;
		color: var(--text-muted);
	}

	.tournament-match-date {
		color: var(--text-muted);
	}

	.tournament-match-winner {
		color: var(--yes);
		font-weight: 700;
	}

	/* Live indicator on the first match of the current round:
	   purple `#b49cff` is the tournament accent. */
	.tournament-match-live {
		color: #b49cff;
		font-weight: 700;
		font-size: 0.65rem;
	}

	.tournament-match-upcoming {
		color: var(--text-muted);
	}

	.tournament-match.is-live {
		border-color: color-mix(in srgb, #b49cff 35%, var(--border-base));
		background: color-mix(in srgb, #b49cff 6%, var(--bg-surface));
	}

	/* Hero head: when the bracket is in flight, the current-round
	   chip + days-left countdown surface here above the headline. */
	.tournament-hero-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.tournament-round-tag {
		display: inline-block;
		padding: 0.15rem 0.55rem;
		border-radius: var(--r-pill);
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: #b49cff;
		background: color-mix(in srgb, #b49cff 18%, transparent);
		border: 1px solid color-mix(in srgb, #b49cff 30%, transparent);
	}

	.tournament-days-left {
		font-size: var(--t-11);
		color: var(--text-muted);
		letter-spacing: 0.08em;
	}

	.tournament-prizes {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.tournament-prize {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		padding: 0.85rem 1rem;
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.tournament-prize.is-gold {
		--prize-tier: #f4c544;
		border-color: color-mix(in srgb, var(--prize-tier) 45%, var(--border-base));
		background: color-mix(in srgb, var(--prize-tier) 6%, var(--bg-surface));
	}

	.tournament-prize.is-silver {
		--prize-tier: #c0c5cc;
		border-color: color-mix(in srgb, var(--prize-tier) 45%, var(--border-base));
		background: color-mix(in srgb, var(--prize-tier) 6%, var(--bg-surface));
	}

	.tournament-prize.is-bronze {
		--prize-tier: #c97c4a;
		border-color: color-mix(in srgb, var(--prize-tier) 45%, var(--border-base));
		background: color-mix(in srgb, var(--prize-tier) 6%, var(--bg-surface));
	}

	/* Rank numeral: tabular mono on a tinted disc. The disc tint
	   reads from `--prize-tier`, the per-tier accent set on the
	   parent `.is-{gold,silver,bronze}` rule, so gold / silver /
	   bronze each get a distinct disc colour. */
	.tournament-prize-place {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		min-width: 1.75rem;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--prize-tier, var(--text-base)) 18%, transparent);
		color: color-mix(in srgb, var(--prize-tier, var(--text-base)) 85%, var(--text-base));
		font-family: var(--font-mono);
		font-feature-settings: 'tnum', 'zero';
		font-variant-numeric: tabular-nums slashed-zero;
		font-size: var(--t-14);
		font-weight: 600;
		line-height: 1;
	}

	.tournament-prize-text {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.tournament-prize-label {
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--text-base);
	}

	.tournament-prize-sticker {
		font-size: var(--t-10);
		letter-spacing: var(--tracking-allcaps);
		color: var(--text-muted);
	}

	.tournament-prize-amount {
		font-size: var(--t-14);
		font-weight: 700;
		color: var(--laurel);
	}

	.tournament-prize-claim {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.85rem 1rem;
		background: color-mix(in srgb, #f4c544 14%, var(--bg-surface));
		border: 1px solid color-mix(in srgb, #f4c544 45%, var(--border-base));
		border-radius: var(--r-12);
	}

	.tournament-prize-claim-eyebrow {
		margin: 0;
		font-size: var(--t-10);
		font-weight: 700;
		letter-spacing: var(--tracking-allcaps);
		color: color-mix(in srgb, #f4c544 70%, var(--text-base));
	}

	.tournament-prize-claim-body {
		margin: 0;
		font-size: var(--t-13);
		line-height: 1.5;
		color: var(--text-base);
	}

	.tournament-prize-claim-dismiss {
		align-self: flex-start;
		appearance: none;
		padding: 0;
		border: 0;
		background: transparent;
		font: inherit;
		font-size: var(--t-12);
		color: var(--text-muted);
		cursor: pointer;
		text-decoration: underline;
	}
</style>
