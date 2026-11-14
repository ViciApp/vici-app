<script lang="ts">
	import { isNullish, nonNullish, notEmptyString } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import ScreenHeader from '#lib/components/layout/ScreenHeader.svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import { DAY_IN_MS } from '#lib/constants/app.constants.ts';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import { safeGetIdentityOnce } from '#lib/services/identity.services.ts';
	import {
		acceptBattle,
		declineBattle,
		kickoffBattle,
		listMyBattles,
		listMyLeagues,
		loadLeaguesByIds,
		readBattleLiveScore,
		resolveBattle,
		retractBattle,
		type BattleLiveScore,
		type LeagueWithRole
	} from '#lib/services/leagues.services.ts';
	import { loadProfilesByPrincipals } from '#lib/services/profile.services.ts';
	import { leagueDirectoryStore } from '#lib/stores/league-directory.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { profilesStore } from '#lib/stores/profiles.store.ts';
	import type { BattleDoc, BattleState } from '#lib/types/battle.ts';
	import { battleScopeLabel } from '#lib/utils/battle.utils.ts';
	import { formatDate, shortenPrincipal, shortLeagueId } from '#lib/utils/format.utils.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { goBack, resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { page } from '$app/state';

	/**
	 * Battle detail: face-off view for a single battle. Shows sideA + sideB
	 * cards with their league names + accents, current scores (or a "–"
	 * placeholder pre-resolve), the state pill, the kickoff/settle
	 * window, and all the same inline transitions the inbox row exposes.
	 *
	 * Reads from `listMyBattles` then filters to the requested id. That's
	 * O(my-battles) per render but our battle volumes are bounded by the
	 * caller's league count, so the cost is fine until we shard. A
	 * future `getBattle` defineQuery would make this a single lookup.
	 */
	interface Props {
		battleId: string;
	}

	const { battleId }: Props = $props();

	let battles: BattleDoc[] = $state([]);
	let memberships: LeagueWithRole[] = $state([]);
	let selfPrincipal: string | undefined = $state();
	let loadState: 'loading' | 'ready' | 'not_found' | 'error' = $state('loading');
	let errorMessage: string | null = $state(null);
	let actingBattleId = $state<string | null>(null);
	// Provisional standings while the battle is in flight: null until the
	// read returns, or for any battle that can't be scored live (duel,
	// non-in_flight, legacy row missing baselines).
	let liveScore = $state<BattleLiveScore | null>(null);
	// True only while the in-flight live-score read is in flight, so the
	// face-off scores can pulse instead of sitting on a static "–" while the
	// two leagues' standings are still being computed.
	let liveScoreLoading = $state(false);
	// Fire `battle_viewed` exactly once per mount, on the first `ready`.
	let viewedTracked = false;
	// Battle id → count of lazy auto-resolve attempts. We retry a transient
	// failure on the next effect pass (there's no manual button to fall back
	// on) but cap it so a persistently failing write doesn't hammer the
	// backend on every re-render.
	const autoResolveAttempts = new SvelteMap<string, number>();
	const MAX_AUTO_RESOLVE_ATTEMPTS = 3;

	// Where the viewer arrived from, for the `battle_viewed` funnel. A
	// bounded vocabulary: anything unrecognised falls back to deep_link.
	const viewSource = $derived.by((): 'inbox' | 'league' | 'deep_link' => {
		const from = page.url.searchParams.get('from');

		return from === 'inbox' || from === 'league' ? from : 'deep_link';
	});

	const load = async () => {
		try {
			const [battleList, mineList, identity] = await Promise.all([
				listMyBattles(),
				listMyLeagues(),
				safeGetIdentityOnce()
			]);
			battles = battleList;
			memberships = mineList;
			selfPrincipal = identity.getPrincipal().toText();
			const found = battles.find((b) => b.id === battleId);
			loadState = nonNullish(found) ? 'ready' : 'not_found';

			if (nonNullish(found) && !viewedTracked) {
				viewedTracked = true;
				track({ name: 'battle_viewed', battleId, label: found.state, source: viewSource });
			}

			// Provisional standings: read-only; resolution stays the lazy
			// auto-resolve path. A failure degrades silently to the "–" render.
			if (nonNullish(found)) {
				// Only league battles in flight return a live score; flagging
				// just those keeps the pulse off rows that resolve to "–" anyway.
				liveScoreLoading = found.state === 'in_flight' && found.kind === 'league';

				try {
					liveScore = await readBattleLiveScore({ battle: found });
				} catch (err) {
					console.error('BattleDetailPage: live score read failed', err);
					liveScore = null;
				} finally {
					liveScoreLoading = false;
				}
			}
		} catch (err) {
			console.error('BattleDetailPage: load failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });
			loadState = 'error';
		}
	};

	onMount(load);

	const battle = $derived(battles.find((b) => b.id === battleId));

	const membershipByLeagueId = $derived.by(() => {
		const map = new SvelteMap<string, LeagueWithRole>();

		for (const m of memberships) {
			map.set(m.league.id, m);
		}

		return map;
	});

	// Resolve a side's league id to its current name (membership →
	// directory cache → shortened id). A 'duel' side is a principal, not
	// a league id, so both lookups miss and the shortened id stands.
	const sideLabel = (sideId: string): string =>
		membershipByLeagueId.get(sideId)?.league.name ??
		$leagueDirectoryStore.get(sideId)?.name ??
		shortLeagueId(sideId);

	const sideAccent = (sideId: string): string =>
		membershipByLeagueId.get(sideId)?.league.accentColor ??
		$leagueDirectoryStore.get(sideId)?.accentColor ??
		'var(--laurel)';

	// Hydrate the directory so the opponent side resolves too, and the
	// proposer's profile so it renders as a handle, not a raw principal.
	$effect(() => {
		if (!battle) {
			return;
		}

		void loadLeaguesByIds({ ids: [battle.sideA, battle.sideB] });
		void loadProfilesByPrincipals({ principals: [battle.proposer] });
	});

	// Proposer handle (`@nickname`), falling back to the shortened principal
	// until, or unless, a profile with a nickname is in the store.
	const proposerLabel = $derived.by((): string => {
		if (!battle) {
			return '';
		}

		const nickname = $profilesStore.get(battle.proposer)?.nickname?.trim();

		return notEmptyString(nickname) ? `@${nickname}` : shortenPrincipal(battle.proposer);
	});

	const ownedSide = $derived.by((): string | undefined => {
		if (!battle) {
			return;
		}

		const a = membershipByLeagueId.get(battle.sideA);

		if (a?.role === 'owner') {
			return battle.sideA;
		}

		const b = membershipByLeagueId.get(battle.sideB);

		return b?.role === 'owner' ? battle.sideB : undefined;
	});

	const stateLabelKey = (state: BattleState): MessageKey => {
		switch (state) {
			case 'proposed':
				return 'leagues.battle.state.proposed';
			case 'accepted':
				return 'leagues.battle.state.accepted';
			case 'in_flight':
				return 'leagues.battle.state.in_flight';
			case 'resolved':
				return 'leagues.battle.state.resolved';
			case 'declined':
				return 'leagues.battle.state.declined';
			case 'expired':
				return 'leagues.battle.state.expired';
		}
	};

	/**
	 * "Day X of Y" countdown when the battle is in flight. Day 1 starts
	 * at kickoff; the total floors to at least one day.
	 */
	const totalDays = $derived.by((): number => {
		if (!battle) {
			return 1;
		}

		const span = battle.settleMs - battle.kickoffMs;

		return Math.max(1, Math.ceil(span / DAY_IN_MS));
	});

	const dayOf = $derived.by((): number => {
		if (!battle) {
			return 1;
		}

		const elapsed = Date.now() - battle.kickoffMs;
		const days = Math.floor(elapsed / DAY_IN_MS) + 1;

		return Math.max(1, Math.min(totalDays, days));
	});

	const canAccept = $derived(battle?.state === 'proposed' && ownedSide === battle.sideB);
	const canDecline = $derived(battle?.state === 'proposed' && ownedSide === battle.sideB);
	const canKickoff = $derived(
		battle?.state === 'accepted' && nonNullish(ownedSide) && Date.now() >= battle.kickoffMs
	);
	// Shown to everyone while a settled battle awaits its silent write:
	// there is no button to press, just a "finalizing" indicator.
	const isFinalizing = $derived(
		nonNullish(battle) && battle.state === 'in_flight' && Date.now() >= battle.settleMs
	);

	// Provisional standings are available: show running accuracy + a
	// "leading" highlight in place of the pre-resolve "–".
	const isLive = $derived(
		nonNullish(battle) && battle.state === 'in_flight' && nonNullish(liveScore)
	);

	// The two leagues' results are being computed: either the live-score read
	// is in flight, or the battle has settled and is finalizing. League-only:
	// duels carry no live league standings, so they keep a steady "–" rather
	// than pulsing through the finalizing window. Drives a pulse on the scores
	// so the wait reads as "calculating", not a stalled "–".
	const isCalculating = $derived(
		nonNullish(battle) &&
			battle.kind === 'league' &&
			battle.state === 'in_flight' &&
			(liveScoreLoading || isFinalizing)
	);

	// Score text for a side: the resolved doc score once resolved, the live
	// projection while in flight, else the pre-resolve placeholder.
	const scoreText = (side: 'A' | 'B'): string => {
		if (nonNullish(battle) && battle.state === 'resolved') {
			const pct = side === 'A' ? battle.scoreA : battle.scoreB;

			return nonNullish(pct)
				? t({ locale: $localeStore, key: 'leagues.battle.score_pct', params: { pct } })
				: '–';
		}

		if (isLive && nonNullish(liveScore)) {
			const pct = side === 'A' ? liveScore.scoreA : liveScore.scoreB;

			return t({ locale: $localeStore, key: 'leagues.battle.score_pct', params: { pct } });
		}

		return '–';
	};

	// Whether a side is ahead: the resolved winner once resolved, the live
	// leader while in flight. A draw highlights neither side.
	const isLeading = (side: 'A' | 'B'): boolean => {
		if (nonNullish(battle) && battle.state === 'resolved') {
			return battle.winner === side;
		}

		return isLive && liveScore?.leader === side;
	};

	// The side whose league the viewer belongs to (any role). Resolution is
	// open to members, not just owners; the satellite re-derives the scores,
	// so the writer can't skew them. Duels carry no members, so they fall
	// back to the principal-owned side.
	const resolverSide = $derived.by((): string | undefined => {
		if (!battle) {
			return;
		}

		if (battle.kind !== 'league') {
			return ownedSide;
		}

		if (membershipByLeagueId.has(battle.sideA)) {
			return battle.sideA;
		}

		return membershipByLeagueId.has(battle.sideB) ? battle.sideB : undefined;
	});

	// Resolution reads each side's accuracy from clearing settlement history,
	// so it needs no kickoff baseline; a settled battle (legacy or not)
	// resolves once a member of either side opens it past its settle time.
	const canResolve = $derived(
		battle?.state === 'in_flight' && nonNullish(resolverSide) && Date.now() >= battle.settleMs
	);
	const canRetract = $derived(
		battle?.state === 'proposed' && nonNullish(selfPrincipal) && battle.proposer === selfPrincipal
	);

	const handleAccept = async () => {
		if (!battle || nonNullish(actingBattleId)) {
			return;
		}

		actingBattleId = battle.id;

		try {
			await acceptBattle({ battle });
			await load();
		} catch (err) {
			console.error('BattleDetailPage: acceptBattle failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			actingBattleId = null;
		}
	};

	const handleDecline = async () => {
		if (!battle || nonNullish(actingBattleId)) {
			return;
		}

		actingBattleId = battle.id;

		try {
			await declineBattle({ battle });
			track({ name: 'battle_declined', battleId: battle.id });
			await load();
		} catch (err) {
			console.error('BattleDetailPage: declineBattle failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			actingBattleId = null;
		}
	};

	const handleKickoff = async () => {
		if (!battle || nonNullish(actingBattleId)) {
			return;
		}

		actingBattleId = battle.id;

		try {
			await kickoffBattle({ battle });
			await load();
		} catch (err) {
			console.error('BattleDetailPage: kickoffBattle failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			actingBattleId = null;
		}
	};

	const handleRetract = async () => {
		if (!battle || nonNullish(actingBattleId)) {
			return;
		}

		actingBattleId = battle.id;

		try {
			await retractBattle({ battle });
			await load();
		} catch (err) {
			console.error('BattleDetailPage: retractBattle failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			actingBattleId = null;
		}
	};

	const trackResolved = ({
		resolved,
		ourSide,
		source
	}: {
		resolved: BattleDoc;
		ourSide: string;
		source: 'auto' | 'nudge';
	}) => {
		const ourLetter = ourSide === resolved.sideA ? 'A' : 'B';
		const isVoid =
			resolved.winner === 'draw' && (resolved.callsA ?? 0) === 0 && (resolved.callsB ?? 0) === 0;
		const label = isVoid
			? 'void'
			: resolved.winner === 'draw'
				? 'draw'
				: resolved.winner === ourLetter
					? 'win'
					: 'loss';

		track({
			name: 'battle_resolved',
			battleId: resolved.id,
			leagueId: ourSide,
			source,
			label,
			value: Math.max(resolved.scoreA ?? 0, resolved.scoreB ?? 0)
		});
	};

	// Resolve the battle in one tap: scores are each league's window
	// accuracy, computed by the service from `league_stats` and re-verified
	// by the satellite assert: there is nothing for the user to enter.
	const handleResolve = async (source: 'auto' | 'nudge') => {
		const ourSide = resolverSide;

		if (!battle || nonNullish(actingBattleId) || isNullish(ourSide)) {
			return;
		}

		const target = battle;
		actingBattleId = target.id;

		try {
			const resolved = await resolveBattle({ battle: target });
			trackResolved({ resolved, ourSide, source });
			await load();
		} catch (err) {
			console.error('BattleDetailPage: resolveBattle failed', err);
			errorMessage = t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			actingBattleId = null;
		}
	};

	// Lazy auto-resolution: Juno has no scheduler, so a settled battle
	// resolves the first time any member of either side opens it. The attempt
	// counter guards against re-firing on every re-render while still letting
	// a transient failure retry up to the cap; resolution is silent, so the
	// page only ever shows a "finalizing" indicator, never a button.
	$effect(() => {
		if (
			canResolve &&
			nonNullish(battle) &&
			isNullish(actingBattleId) &&
			(autoResolveAttempts.get(battle.id) ?? 0) < MAX_AUTO_RESOLVE_ATTEMPTS
		) {
			autoResolveAttempts.set(battle.id, (autoResolveAttempts.get(battle.id) ?? 0) + 1);
			void handleResolve('auto');
		}
	});

	// Return to wherever the viewer came from in-app: `history.back()`
	// restores the originating Arena tab (the tab strip mirrors itself into
	// the URL on selection). When they landed here cold; a deep link or fresh
	// tab with no in-app history: `goBack` falls back to Arena's Friends tab.
	const handleBack = () => {
		goBack(resolveAppPath(AppPath.Arena));
	};
</script>

<div class="battle-detail">
	<ScreenHeader
		back={{
			label: t({ locale: $localeStore, key: 'battle.detail.back' }),
			onBack: handleBack
		}}
		title={t({ locale: $localeStore, key: 'battle.detail.title' })}
	/>

	{#if loadState === 'loading'}
		<p class="battle-detail-status" aria-busy="true">
			{t({ locale: $localeStore, key: 'battle.detail.loading' })}
		</p>
	{:else if loadState === 'error'}
		<p class="battle-detail-error" role="alert">
			{errorMessage ?? t({ locale: $localeStore, key: 'leagues.error.generic' })}
		</p>
	{:else if loadState === 'not_found' || !battle}
		<section class="battle-detail-empty">
			<h2>{t({ locale: $localeStore, key: 'battle.detail.not_found.title' })}</h2>
			<p>{t({ locale: $localeStore, key: 'battle.detail.not_found.sub' })}</p>
		</section>
	{:else}
		<section class="battle-detail-faceoff" data-state={battle.state}>
			<header class="battle-detail-faceoff-head">
				<span class="allcaps battle-detail-eyebrow" data-state={battle.state}>
					{t({ locale: $localeStore, key: stateLabelKey(battle.state) })}
				</span>
				{#if battle.state === 'in_flight' && !isFinalizing}
					<span class="num allcaps battle-detail-window">
						{t({
							locale: $localeStore,
							key: 'battle.detail.day_of',
							params: { day: dayOf, total: totalDays }
						})}
					</span>
				{:else if battle.state === 'proposed'}
					<span class="num allcaps battle-detail-window">
						{t({ locale: $localeStore, key: 'battle.detail.awaiting_acceptance' })}
					</span>
				{:else}
					<span class="num allcaps battle-detail-window">
						{formatDate(battle.kickoffMs)} → {formatDate(battle.settleMs)}
					</span>
				{/if}
			</header>

			<div class="battle-detail-stage">
				<div
					style:--team-accent={sideAccent(battle.sideA)}
					class="battle-detail-team"
					class:is-leading={isLeading('A')}
				>
					<span class="battle-detail-emblem" aria-hidden="true">
						{sideLabel(battle.sideA).charAt(0)}
					</span>
					<span class="battle-detail-team-name">{sideLabel(battle.sideA)}</span>
					<span class="battle-detail-score num" class:is-calculating={isCalculating}>
						{scoreText('A')}
					</span>
				</div>

				<span class="battle-detail-vs serif-italic">vs</span>

				<div
					style:--team-accent={sideAccent(battle.sideB)}
					class="battle-detail-team"
					class:is-leading={isLeading('B')}
				>
					<span class="battle-detail-emblem" aria-hidden="true">
						{sideLabel(battle.sideB).charAt(0)}
					</span>
					<span class="battle-detail-team-name">{sideLabel(battle.sideB)}</span>
					<span class="battle-detail-score num" class:is-calculating={isCalculating}>
						{scoreText('B')}
					</span>
				</div>
			</div>

			{#if isLive}
				<p class="allcaps battle-detail-live-note">
					{t({ locale: $localeStore, key: 'battle.detail.live_provisional' })}
				</p>
			{/if}

			{#if battle.state === 'resolved' && battle.winner === 'draw'}
				<p class="allcaps battle-detail-winner">
					{(battle.callsA ?? 0) === 0 && (battle.callsB ?? 0) === 0
						? t({ locale: $localeStore, key: 'leagues.battle.winner_void' })
						: t({ locale: $localeStore, key: 'leagues.battle.winner_draw' })}
				</p>
			{:else if battle.state === 'proposed'}
				<p class="serif-italic battle-detail-pending-foot">
					{t({ locale: $localeStore, key: 'battle.detail.pending_foot' })}
				</p>
			{/if}
		</section>

		<section class="battle-detail-meta">
			<div class="battle-detail-meta-row">
				<span class="eyebrow">{t({ locale: $localeStore, key: 'battle.detail.kind_label' })}</span>
				<span class="num allcaps">{battle.kind}</span>
			</div>
			<div class="battle-detail-meta-row">
				<span class="eyebrow">{t({ locale: $localeStore, key: 'battle.detail.scope_label' })}</span>
				<span class="num allcaps"
					>{battleScopeLabel({ scope: battle.scope, locale: $localeStore })}</span
				>
			</div>
			{#if nonNullish(battle.wager) && battle.wager > 0}
				<div class="battle-detail-meta-row">
					<span class="eyebrow"
						>{t({ locale: $localeStore, key: 'battle.detail.wager_label' })}</span
					>
					<span class="num">
						{t({
							locale: $localeStore,
							key: 'battle.detail.wager_value',
							params: { amount: battle.wager }
						})}
					</span>
				</div>
			{/if}
			<div class="battle-detail-meta-row">
				<span class="eyebrow">{t({ locale: $localeStore, key: 'battle.detail.proposer' })}</span>
				<span class="num battle-detail-meta-mono">
					{proposerLabel}
				</span>
			</div>
		</section>

		{#if nonNullish(battle.trashTalk) && battle.trashTalk.length > 0}
			<section class="battle-detail-trash-talk">
				<span class="eyebrow">
					{t({ locale: $localeStore, key: 'battle.detail.trash_talk_label' })}
				</span>
				<p class="serif-italic battle-detail-trash-talk-quote">“{battle.trashTalk}”</p>
			</section>
		{/if}

		<section class="battle-detail-actions">
			{#if canAccept}
				<button
					class="battle-detail-action is-primary"
					disabled={actingBattleId === battle.id}
					onclick={handleAccept}
					type="button"
				>
					{actingBattleId === battle.id
						? t({ locale: $localeStore, key: 'leagues.battle.action.accepting' })
						: t({ locale: $localeStore, key: 'leagues.battle.action.accept' })}
				</button>
				{#if canDecline}
					<button
						class="battle-detail-action is-danger"
						disabled={actingBattleId === battle.id}
						onclick={handleDecline}
						type="button"
					>
						{actingBattleId === battle.id
							? t({ locale: $localeStore, key: 'leagues.battle.action.declining' })
							: t({ locale: $localeStore, key: 'leagues.battle.action.decline' })}
					</button>
				{/if}
			{:else if canKickoff}
				<button
					class="battle-detail-action is-primary"
					disabled={actingBattleId === battle.id}
					onclick={handleKickoff}
					type="button"
				>
					{actingBattleId === battle.id
						? t({ locale: $localeStore, key: 'leagues.battle.action.starting' })
						: t({ locale: $localeStore, key: 'leagues.battle.action.kickoff' })}
				</button>
			{:else if isFinalizing}
				<p class="battle-detail-finalizing num" aria-live="polite" role="status">
					<LoadingSpinner size="xs" />
					<span>{t({ locale: $localeStore, key: 'leagues.battle.action.finalizing' })}</span>
				</p>
			{/if}
			{#if canRetract}
				<button
					class="battle-detail-action is-danger"
					disabled={actingBattleId === battle.id}
					onclick={handleRetract}
					type="button"
				>
					{actingBattleId === battle.id
						? t({ locale: $localeStore, key: 'leagues.battle.action.retracting' })
						: t({ locale: $localeStore, key: 'leagues.battle.action.retract' })}
				</button>
			{/if}
		</section>
	{/if}
</div>

<style lang="postcss">
	.battle-detail {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0 1.25rem 6rem;
	}

	.battle-detail-status,
	.battle-detail-error {
		margin: 0;
		padding: 1rem;
		font-size: var(--t-13);
		border-radius: var(--r-12);
	}

	.battle-detail-status {
		color: var(--text-muted);
		background: color-mix(in srgb, var(--bg-surface) 86%, transparent);
		border: 1px solid var(--border-base);
	}

	.battle-detail-error {
		color: var(--no);
		background: color-mix(in srgb, var(--no-wash, var(--no)) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--no) 35%, var(--border-base));
	}

	.battle-detail-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 2.5rem 1rem;
		text-align: center;
		background: color-mix(in srgb, var(--bg-surface) 86%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.battle-detail-empty h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--t-16, 1rem);
		color: var(--text-base);
	}

	.battle-detail-empty p {
		margin: 0;
		font-size: var(--t-13);
		color: var(--text-muted);
	}

	.battle-detail-faceoff {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 1rem;
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.battle-detail-faceoff[data-state='in_flight'] {
		border-color: color-mix(in srgb, var(--laurel) 38%, var(--border-base));
	}

	.battle-detail-faceoff-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.battle-detail-eyebrow {
		font-size: var(--t-10);
		letter-spacing: var(--tracking-allcaps);
		padding: 0.1rem 0.5rem;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--text-muted) 18%, transparent);
		color: var(--text-muted);
	}

	.battle-detail-eyebrow[data-state='in_flight'] {
		background: color-mix(in srgb, var(--laurel) 22%, transparent);
		color: var(--laurel);
	}

	.battle-detail-window {
		font-size: var(--t-10);
		color: var(--text-muted);
	}

	.battle-detail-stage {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		gap: 0.6rem;
		align-items: center;
	}

	.battle-detail-team {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		padding: 0.8rem 0.5rem;
		background: color-mix(in srgb, var(--team-accent) 8%, var(--bg-surface));
		border: 1px solid color-mix(in srgb, var(--team-accent) 25%, var(--border-base));
		border-radius: var(--r-12);
		min-width: 0;
	}

	.battle-detail-team.is-leading {
		border-color: color-mix(in srgb, var(--team-accent) 55%, var(--border-base));
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--team-accent) 30%, transparent);
	}

	.battle-detail-emblem {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		font-size: var(--t-18, 1.2rem);
		font-weight: 700;
		color: var(--text-base);
		background: color-mix(in srgb, var(--team-accent) 22%, var(--bg-surface));
		border-radius: var(--r-pill);
	}

	.battle-detail-team-name {
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--text-base);
		text-align: center;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}

	.battle-detail-score {
		font-size: var(--t-22, 1.4rem);
		font-weight: 700;
		color: var(--team-accent);
	}

	/* While the two leagues' results are being computed the score sits on a
	   "–" placeholder; pulsing it reads as "calculating" rather than stalled. */
	.battle-detail-score.is-calculating {
		animation: battle-detail-score-pulse 1.2s ease-in-out infinite;
	}

	@keyframes battle-detail-score-pulse {
		0%,
		100% {
			opacity: 0.3;
		}
		50% {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.battle-detail-score.is-calculating {
			animation: none;
			opacity: 0.6;
		}
	}

	.battle-detail-vs {
		font-size: var(--t-14);
		color: var(--text-muted);
	}

	.battle-detail-winner {
		margin: 0;
		font-size: var(--t-11);
		letter-spacing: var(--tracking-allcaps);
		text-align: center;
		color: var(--text-muted);
	}

	.battle-detail-live-note {
		margin: 0;
		font-size: var(--t-10);
		letter-spacing: var(--tracking-allcaps);
		text-align: center;
		color: var(--laurel);
	}

	.battle-detail-pending-foot {
		margin: 0;
		font-size: var(--t-13);
		line-height: 1.45;
		text-align: center;
		color: var(--text-muted);
	}

	.battle-detail-meta {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.85rem 1rem;
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.battle-detail-meta-row {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.battle-detail-meta-row .eyebrow {
		color: var(--text-muted);
	}

	.battle-detail-meta-mono {
		font-size: var(--t-12);
		color: var(--text-muted);
	}

	.battle-detail-trash-talk {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.85rem 1rem;
		background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.battle-detail-trash-talk .eyebrow {
		color: var(--text-muted);
	}

	.battle-detail-trash-talk-quote {
		margin: 0;
		font-size: var(--t-15, 0.95rem);
		line-height: 1.45;
		color: var(--text-base);
	}

	.battle-detail-actions {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.battle-detail-finalizing {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--t-13);
		font-weight: 700;
		color: var(--text-muted);
	}

	.battle-detail-action {
		appearance: none;
		padding: 0.75rem 1.1rem;
		font: inherit;
		font-size: var(--t-13);
		font-weight: 700;
		border-radius: var(--r-pill);
		cursor: pointer;
		transition:
			background 140ms ease,
			border-color 140ms ease;
	}

	.battle-detail-action.is-primary {
		color: var(--text-on-accent, #fff);
		background: var(--laurel);
		border: 1px solid var(--laurel);
	}

	.battle-detail-action.is-primary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--laurel) 88%, var(--text-base));
	}

	.battle-detail-action.is-danger {
		color: var(--no);
		background: color-mix(in srgb, var(--no-wash, var(--no)) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--no) 35%, var(--border-base));
	}

	.battle-detail-action.is-danger:hover:not(:disabled) {
		background: color-mix(in srgb, var(--no-wash, var(--no)) 20%, transparent);
	}

	.battle-detail-action:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
