<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { ArrowRight, Check } from '@lucide/svelte/icons';
	import { onMount, tick } from 'svelte';
	import { get } from 'svelte/store';
	import type { ClearingDid } from '#declarations';
	import BottomSheet from '#lib/components/ui/BottomSheet.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { ZERO } from '#lib/constants/app.constants.ts';
	import { INFO_EMAIL } from '#lib/constants/contact.constants.ts';
	import { PLAYGROUND_CLEARING_MARGIN_DECIMALS } from '#lib/constants/playground.constants.ts';
	import { balanceDomain } from '#lib/derived/balance-domain.derived.ts';
	import {
		deleteMyAccount,
		hibernateMyAccount,
		type LeagueResolution,
		listMyBlockingLeagues
	} from '#lib/services/account.services.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import { listLeagueMembers, listMyLeagues } from '#lib/services/leagues.services.ts';
	import { cancelLimitOrder, getUserOrders } from '#lib/services/order.services.ts';
	import { getPositions } from '#lib/services/position.services.ts';
	import { loadProfilesByPrincipals } from '#lib/services/profile.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { profilesStore } from '#lib/stores/profiles.store.ts';
	import type { ButtonStatus } from '#lib/types/components.ts';
	import { EXIT_SIGNAL_NOTE_MAX_LENGTH, type ExitSignalReason } from '#lib/types/exit-signal.ts';
	import type { LeagueMemberDoc } from '#lib/types/league-member.ts';
	import { mailtoHref } from '#lib/utils/email.utils.ts';
	import { createFocusTrap, type FocusTrap } from '#lib/utils/focus-trap.utils.ts';
	import { shortenPrincipal } from '#lib/utils/format.utils.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { formatVxpBalance } from '#lib/utils/playground-display.utils.ts';
	import { browser } from '$app/env';

	/**
	 * Six-beat account-deletion flow, docked in a {@link BottomSheet}.
	 *
	 * `reason → what-happens → leagues → confirm → gone`. The
	 * `deleting` beat is folded into `confirm`'s spinner — there is no
	 * separate sheet for the in-flight moment. Owned non-empty leagues
	 * must be resolved (transferred or disbanded) before the confirm
	 * step unlocks; open orders are cancelled FE-side first because the
	 * satellite can't reach the clearing engine.
	 */
	interface Props {
		isOpen: boolean;
		/** The user's handle — typed back on the confirm step. */
		nickname: string;
		onClose: () => void;
		/** Sign-out path reused from the host page. */
		onSignOut: () => Promise<void> | void;
	}

	const { isOpen, nickname, onClose, onSignOut }: Props = $props();

	type Step = 'reason' | 'what-happens' | 'leagues' | 'confirm' | 'gone';

	let step = $state<Step>('reason');

	// Reason ----------------------------------------------------------
	let reason = $state<ExitSignalReason | null>(null);
	let note = $state('');

	const reasonOptions: ReadonlyArray<{ id: ExitSignalReason; key: MessageKey }> = [
		{ id: 'not-for-me', key: 'settings.delete.reason.not_for_me' },
		{ id: 'too-busy', key: 'settings.delete.reason.too_busy' },
		{ id: 'privacy', key: 'settings.delete.reason.privacy' },
		{ id: 'duplicate', key: 'settings.delete.reason.duplicate' },
		{ id: 'bugs', key: 'settings.delete.reason.bugs' },
		{ id: 'other', key: 'settings.delete.reason.other' }
	];

	// Disclosure counts -----------------------------------------------
	let openOrders = $state<ClearingDid.LimitOrder[]>([]);
	let ownedLeagues = $state<{ id: string; name: string; memberCount: number }[]>([]);
	let activeTradeCount = $state(0);
	let activeTradeValue = $state<bigint>(ZERO);
	let hasTradeData = $state(false);
	let dataLoaded = $state(false);

	const openOrderCount = $derived(openOrders.length);
	const openOrderValue = $derived(openOrders.reduce((sum, o) => sum + o.blocked_margin_usd, ZERO));
	const ownedLeagueCount = $derived(ownedLeagues.length);

	const formatVxp = (value: bigint): string =>
		formatVxpBalance({ value, decimals: PLAYGROUND_CLEARING_MARGIN_DECIMALS });

	// Leagues resolution ----------------------------------------------
	interface LeagueResolutionDraft {
		action: 'transfer' | 'delete' | null;
		transferTo: string | null;
		/** The delete pill has been pressed (the inline confirm). */
		deleteConfirmed: boolean;
		members: LeagueMemberDoc[];
	}

	let resolutions = $state<Record<string, LeagueResolutionDraft>>({});

	const isLeagueResolved = (id: string): boolean => {
		const r = resolutions[id];

		if (!r) {
			return false;
		}

		if (r.action === 'transfer') {
			return nonNullish(r.transferTo) && r.transferTo.length > 0;
		}

		if (r.action === 'delete') {
			return r.deleteConfirmed;
		}

		return false;
	};

	const allLeaguesResolved = $derived(ownedLeagues.every((l) => isLeagueResolved(l.id)));

	const buildResolutions = (): LeagueResolution[] =>
		ownedLeagues.map((l) => {
			const r = resolutions[l.id];

			if (r?.action === 'transfer' && nonNullish(r.transferTo)) {
				return { leagueId: l.id, action: 'transfer', transferTo: r.transferTo };
			}

			return { leagueId: l.id, action: 'delete' };
		});

	// Confirm ----------------------------------------------------------
	let typedHandle = $state('');
	let deleteStatus = $state<ButtonStatus>('enabled');
	let inFlight = $state(false);
	let errorKey = $state<MessageKey | null>(null);
	let errorParams = $state<Record<string, string | number> | undefined>(undefined);
	let confirmInputEl = $state<HTMLInputElement | undefined>();

	// Gone takeover — focus trap
	let goneDialogEl = $state<HTMLDivElement | undefined>();
	let goneTrap: FocusTrap | null = null;

	const handleMatches = $derived(
		nickname.length > 0 && typedHandle.trim().toLowerCase() === nickname.toLowerCase()
	);

	// Gone countdown ---------------------------------------------------
	const REDIRECT_DELAY_SECONDS = 5;
	let countdown = $state(REDIRECT_DELAY_SECONDS);
	let countdownTimer: ReturnType<typeof setInterval> | undefined;

	const memberHandle = (principal: string): string => {
		const profile = $profilesStore.get(principal);

		if (profile?.nickname && profile.nickname.length > 0) {
			return `@${profile.nickname}`;
		}

		return shortenPrincipal(principal);
	};

	const transferCandidates = (id: string): LeagueMemberDoc[] => {
		const r = resolutions[id];

		if (!r) {
			return [];
		}

		return [...r.members]
			.filter((m) => m.role !== 'owner')
			.sort((a, b) => a.joinedAtMs - b.joinedAtMs);
	};

	const resetState = () => {
		step = 'reason';
		reason = null;
		note = '';
		openOrders = [];
		ownedLeagues = [];
		activeTradeCount = 0;
		activeTradeValue = ZERO;
		hasTradeData = false;
		dataLoaded = false;
		resolutions = {};
		typedHandle = '';
		deleteStatus = 'enabled';
		inFlight = false;
		errorKey = null;
		errorParams = undefined;
		countdown = REDIRECT_DELAY_SECONDS;
	};

	const handleClose = () => {
		if (inFlight) {
			return;
		}

		onClose();
	};

	/**
	 * Load the disclosure figures once the sheet opens. Each fetch
	 * degrades on its own: an orders failure leaves the open-orders row
	 * hidden, a positions failure hides the active-trades row, etc.
	 * Owned leagues are sourced from `listMyLeagues` (role === 'owner')
	 * and cross-checked against `listMyBlockingLeagues` so the leagues
	 * step only surfaces leagues that actually block deletion (own +
	 * other members present).
	 */
	const loadData = async () => {
		const domain = get(balanceDomain);

		try {
			openOrders = await getUserOrders(domain);
		} catch (_err: unknown) {
			openOrders = [];
		}

		try {
			const positions = await getPositions(domain);
			const live = positions.filter((p) => p.netQty !== ZERO);
			activeTradeCount = live.length;
			activeTradeValue = live.reduce((sum, p) => sum + p.lockedCollateral, ZERO);
			hasTradeData = true;
		} catch (_err: unknown) {
			hasTradeData = false;
		}

		try {
			const [leagues, blockingIds] = await Promise.all([listMyLeagues(), listMyBlockingLeagues()]);
			const blocking = new Set(blockingIds);
			const owned = leagues.filter((l) => l.role === 'owner' && blocking.has(l.league.id));

			const drafts: Record<string, LeagueResolutionDraft> = {};

			const hydrated = await Promise.all(
				owned.map(async ({ league }) => {
					let members: LeagueMemberDoc[];

					try {
						members = await listLeagueMembers({ leagueId: league.id });
					} catch (_err: unknown) {
						members = [];
					}

					drafts[league.id] = {
						action: null,
						transferTo: null,
						deleteConfirmed: false,
						members
					};

					return {
						id: league.id,
						name: league.name,
						memberCount: members.length
					};
				})
			);

			ownedLeagues = hydrated;
			resolutions = drafts;

			const principals = Object.values(drafts).flatMap((d) => d.members.map((m) => m.member));

			if (principals.length > 0) {
				void loadProfilesByPrincipals({ principals });
			}
		} catch (_err: unknown) {
			ownedLeagues = [];
		}

		dataLoaded = true;
	};

	const goToDisclosure = async () => {
		if (isNullish(reason)) {
			return;
		}

		step = 'what-happens';

		if (!dataLoaded) {
			await loadData();
		}
	};

	const advanceFromDisclosure = () => {
		step = ownedLeagueCount > 0 ? 'leagues' : 'confirm';
	};

	const pause30Days = async () => {
		let result: Awaited<ReturnType<typeof hibernateMyAccount>>;

		try {
			result = await hibernateMyAccount();
		} catch (_err: unknown) {
			errorKey = 'settings.delete.error';
			errorParams = undefined;

			return;
		}

		// The wrapper resolves (doesn't throw) on a satellite refusal
		// (`no_profile` / already soft-deleted). Surface it instead of
		// signing the user out as if the pause succeeded.
		if (!result.ok) {
			errorKey = 'settings.delete.error';
			errorParams = undefined;

			return;
		}

		await Promise.resolve(onSignOut());
		onClose();
	};

	const enterConfirm = async () => {
		step = 'confirm';
		await tick();
		confirmInputEl?.focus();
	};

	/**
	 * The delete sequence. Cancel every open order against the clearing
	 * engine first (the satellite cannot), abort if any cancel fails,
	 * then call `deleteMyAccount`. Map the structured refusal reasons to
	 * inline copy; on `owns_non_empty_league` bounce back to the leagues
	 * step so the user can resolve them. On success advance to `gone`.
	 */
	const runDelete = async () => {
		if (!handleMatches || inFlight) {
			return;
		}

		inFlight = true;
		deleteStatus = 'pending';
		errorKey = null;
		errorParams = undefined;

		// Call `deleteMyAccount` FIRST. The satellite applies league resolution
		// + the owner-leagues guard BEFORE the soft-delete, so a refusal
		// (`owns_non_empty_league` / `league_resolution_failed`) leaves the
		// account fully intact. We must not cancel the user's open orders
		// until the delete has actually committed — otherwise a transient
		// refusal would irreversibly wipe orders without deleting anything.
		let result: Awaited<ReturnType<typeof deleteMyAccount>>;

		try {
			result = await deleteMyAccount({
				reason: reason ?? 'other',
				note: note.trim(),
				leagueResolutions: ownedLeagueCount > 0 ? buildResolutions() : undefined
			});
		} catch (_err: unknown) {
			errorKey = 'settings.delete.error';
			errorParams = undefined;
			deleteStatus = 'enabled';
			inFlight = false;

			return;
		}

		if (!result.ok) {
			if (result.reason === 'owns_non_empty_league') {
				deleteStatus = 'enabled';
				inFlight = false;
				await loadData();
				step = 'leagues';

				return;
			}

			if (result.reason === 'league_resolution_failed') {
				const failed = ownedLeagues.find((l) => l.id === result.failedLeagueId);
				errorKey = 'settings.delete.error_handoff';
				errorParams = { league: failed?.name ?? result.failedLeagueId ?? '' };
			} else {
				errorKey = 'settings.delete.error';
				errorParams = undefined;
			}

			deleteStatus = 'enabled';
			inFlight = false;

			return;
		}

		// Soft-delete committed. Now cancel open orders FE-side (the satellite
		// can't reach the clearing engine). A cancel failure here can't undo
		// the delete — the account is recoverable for 30 days and any open
		// trades settle at expiry regardless — so we still proceed to `gone`.
		try {
			for (const order of openOrders) {
				await cancelLimitOrder(order.order_id);
			}
		} catch (err: unknown) {
			console.error('DeleteAccountFlow: order cancel after delete failed', err);
		}

		step = 'gone';
		startCountdown();
	};

	const finish = async () => {
		clearCountdown();
		await Promise.resolve(onSignOut());
		onClose();
	};

	const startCountdown = () => {
		clearCountdown();
		countdown = REDIRECT_DELAY_SECONDS;
		countdownTimer = setInterval(() => {
			countdown -= 1;

			if (countdown <= 0) {
				void finish();
			}
		}, 1000);
	};

	const clearCountdown = () => {
		if (countdownTimer) {
			clearInterval(countdownTimer);
			countdownTimer = undefined;
		}
	};

	// Reset to the first beat each time the sheet (re)opens so a
	// re-entry never lands mid-flow on stale state. Each (re)open is a
	// genuine churn-funnel entry, so it also emits `delete_flow_opened` —
	// the top of the delete funnel the server-side `delete_confirmed` /
	// `delete_succeeded` events complete.
	$effect(() => {
		if (isOpen) {
			resetState();
			track({ name: 'delete_flow_opened', source: 'settings' });
		} else {
			clearCountdown();
		}
	});

	// Manage the focus trap for the full-bleed "gone" takeover. The dialog
	// auto-redirects via countdown, so the trap stays active until finish()
	// clears it and closes the flow. Esc is intentionally not wired here —
	// the takeover redirects automatically and there is no cancel action.
	$effect(() => {
		if (!browser) {
			return;
		}

		if (isOpen && step === 'gone' && goneDialogEl) {
			goneTrap = createFocusTrap(goneDialogEl);
			goneTrap.activate();
		} else if (goneTrap) {
			goneTrap.deactivate();
			goneTrap = null;
		}

		return () => {
			if (goneTrap) {
				goneTrap.deactivate();
				goneTrap = null;
			}
		};
	});

	onMount(() => () => clearCountdown());
</script>

<BottomSheet isOpen={isOpen && step !== 'gone'} onClose={handleClose}>
	{#if step === 'reason'}
		<div class="del">
			<h2 class="del-title">
				{t({ locale: $localeStore, key: 'settings.delete.reason_heading' })}
			</h2>
			<p class="del-lede">
				{t({ locale: $localeStore, key: 'settings.delete.reason_body' })}
				<span class="del-lede-acc">
					{t({ locale: $localeStore, key: 'settings.delete.reason_body_acc' })}
				</span>
			</p>

			<div class="del-reasons" role="group">
				{#each reasonOptions as opt (opt.id)}
					<button
						class="del-reason"
						class:is-active={reason === opt.id}
						aria-pressed={reason === opt.id}
						onclick={() => (reason = opt.id)}
						type="button"
					>
						{t({ locale: $localeStore, key: opt.key })}
					</button>
				{/each}
			</div>

			{#if nonNullish(reason)}
				<textarea
					class="del-note"
					maxlength={EXIT_SIGNAL_NOTE_MAX_LENGTH}
					placeholder={t({ locale: $localeStore, key: 'settings.delete.note_placeholder' })}
					rows="3"
					bind:value={note}></textarea>
			{/if}

			<div class="del-retain">
				<p class="del-retain-head">
					{t({ locale: $localeStore, key: 'settings.delete.stay_heading' })}
				</p>
				<p class="del-retain-body">
					{t({ locale: $localeStore, key: 'settings.delete.stay_body' })}
				</p>
				<div class="del-retain-actions">
					<button class="del-retain-btn" onclick={pause30Days} type="button">
						{t({ locale: $localeStore, key: 'settings.delete.stay_pause' })}
					</button>
					<a class="del-retain-btn" href={mailtoHref(INFO_EMAIL)}>
						{t({ locale: $localeStore, key: 'settings.delete.stay_contact' })}
					</a>
				</div>
			</div>

			{#if nonNullish(errorKey)}
				<p class="del-error" role="alert">
					{t({ locale: $localeStore, key: errorKey, params: errorParams })}
				</p>
			{/if}

			<div class="del-actions">
				<Button onclick={handleClose} variant="ghost">
					{t({ locale: $localeStore, key: 'settings.delete.never_mind' })}
				</Button>
				<Button
					class="del-danger-btn"
					onclick={goToDisclosure}
					status={isNullish(reason) ? 'disabled' : 'enabled'}
					variant="danger"
				>
					{t({ locale: $localeStore, key: 'settings.delete.continue' })}
					<ArrowRight aria-hidden="true" size={16} strokeWidth={1.8} />
				</Button>
			</div>
		</div>
	{:else if step === 'what-happens'}
		<div class="del">
			<h2 class="del-title" data-tone="danger">
				{t({ locale: $localeStore, key: 'settings.delete.happens_heading' })}
			</h2>
			<p class="del-lede">
				{t({ locale: $localeStore, key: 'settings.delete.happens_lede' })}
				<span class="del-lede-danger">
					{t({ locale: $localeStore, key: 'settings.delete.happens_lede_warn' })}
				</span>
			</p>

			<ul class="del-rows">
				<li class="del-row" data-first="true">
					<span class="del-row-icon" aria-hidden="true" data-tone="ok">
						<Check size={11} strokeWidth={3.5} />
					</span>
					<div class="del-row-text">
						<span class="del-row-label">
							{t({ locale: $localeStore, key: 'settings.delete.happens_profile_label' })}
						</span>
						<span class="del-row-sub">
							{t({ locale: $localeStore, key: 'settings.delete.happens_profile_sub' })}
						</span>
					</div>
				</li>

				{#if openOrderCount > 0}
					<li class="del-row">
						<span class="del-row-icon" aria-hidden="true" data-tone="ok">
							<Check size={11} strokeWidth={3.5} />
						</span>
						<div class="del-row-text">
							<span class="del-row-label">
								{t({
									locale: $localeStore,
									key: 'settings.delete.happens_orders_label',
									params: { count: openOrderCount, value: formatVxp(openOrderValue) }
								})}
							</span>
							<span class="del-row-sub">
								{t({ locale: $localeStore, key: 'settings.delete.happens_orders_sub' })}
							</span>
						</div>
					</li>
				{/if}

				{#if hasTradeData && activeTradeCount > 0}
					<li class="del-row">
						<span class="del-row-icon" aria-hidden="true" data-tone="danger">
							<span class="del-row-bang">!</span>
						</span>
						<div class="del-row-text">
							<span class="del-row-label">
								{t({
									locale: $localeStore,
									key: 'settings.delete.happens_trades_label',
									params: { count: activeTradeCount, value: formatVxp(activeTradeValue) }
								})}
							</span>
							<span class="del-row-sub">
								{t({ locale: $localeStore, key: 'settings.delete.happens_trades_sub' })}
							</span>
						</div>
					</li>
				{/if}

				{#if ownedLeagueCount > 0}
					<li class="del-row">
						<span class="del-row-icon" aria-hidden="true" data-tone="danger">
							<span class="del-row-bang">!</span>
						</span>
						<div class="del-row-text">
							<span class="del-row-label">
								{t({
									locale: $localeStore,
									key: 'settings.delete.happens_leagues_label',
									params: { count: ownedLeagueCount }
								})}
							</span>
							<span class="del-row-sub">
								{t({ locale: $localeStore, key: 'settings.delete.happens_leagues_sub' })}
							</span>
						</div>
					</li>
				{/if}

				<li class="del-row">
					<span class="del-row-icon" aria-hidden="true" data-tone="ok">
						<Check size={11} strokeWidth={3.5} />
					</span>
					<div class="del-row-text">
						<span class="del-row-label">
							{t({ locale: $localeStore, key: 'settings.delete.happens_social_label' })}
						</span>
						<span class="del-row-sub">
							{t({ locale: $localeStore, key: 'settings.delete.happens_social_sub' })}
						</span>
					</div>
				</li>
			</ul>

			<div class="del-actions">
				<Button onclick={() => (step = 'reason')} variant="ghost"
					>{t({ locale: $localeStore, key: 'settings.delete.back' })}</Button
				>
				<Button class="del-danger-btn" onclick={advanceFromDisclosure} variant="danger"
					>{t({ locale: $localeStore, key: 'settings.delete.understand' })}</Button
				>
			</div>
		</div>
	{:else if step === 'leagues'}
		<div class="del">
			<h2 class="del-title">
				{t({ locale: $localeStore, key: 'settings.delete.leagues_heading' })}
			</h2>
			<p class="del-body">{t({ locale: $localeStore, key: 'settings.delete.leagues_body' })}</p>

			<div class="del-leagues">
				{#each ownedLeagues as league (league.id)}
					{@const draft = resolutions[league.id]}
					<div class="del-league" class:is-resolved={isLeagueResolved(league.id)}>
						<div class="del-league-head">
							<div class="del-league-id">
								<span class="del-league-name">{league.name}</span>
								<span class="del-league-meta">
									{t({
										locale: $localeStore,
										key: 'settings.delete.leagues_meta',
										params: { count: league.memberCount }
									})}
								</span>
							</div>
							{#if isLeagueResolved(league.id)}
								<span class="del-league-tick" aria-hidden="true">
									<Check size={10} strokeWidth={3.5} />
								</span>
							{/if}
						</div>

						<div class="del-league-modes">
							<button
								class="del-league-mode"
								class:is-transfer={draft?.action === 'transfer'}
								aria-pressed={draft?.action === 'transfer'}
								disabled={transferCandidates(league.id).length === 0}
								onclick={() =>
									(resolutions = {
										...resolutions,
										[league.id]: { ...draft, action: 'transfer', deleteConfirmed: false }
									})}
								type="button"
							>
								{t({ locale: $localeStore, key: 'settings.delete.leagues_transfer' })}
							</button>
							<button
								class="del-league-mode"
								class:is-delete={draft?.action === 'delete'}
								aria-pressed={draft?.action === 'delete'}
								onclick={() =>
									(resolutions = {
										...resolutions,
										[league.id]: {
											...draft,
											action: 'delete',
											transferTo: null,
											deleteConfirmed: false
										}
									})}
								type="button"
							>
								{t({ locale: $localeStore, key: 'settings.delete.leagues_delete' })}
							</button>
						</div>

						{#if draft?.action === 'transfer'}
							{#if transferCandidates(league.id).length === 0}
								<p class="del-league-empty">
									{t({ locale: $localeStore, key: 'settings.delete.leagues_no_members' })}
								</p>
							{:else}
								<label class="del-league-select-wrap">
									<span class="del-league-select-label">
										{t({ locale: $localeStore, key: 'settings.delete.leagues_transfer_to' })}
									</span>
									<select
										class="del-league-select"
										onchange={(e) =>
											(resolutions = {
												...resolutions,
												[league.id]: {
													...draft,
													transferTo:
														e.currentTarget.value.length > 0 ? e.currentTarget.value : null
												}
											})}
										value={draft.transferTo ?? ''}
									>
										<option value="">
											{t({ locale: $localeStore, key: 'settings.delete.leagues_select_member' })}
										</option>
										{#each transferCandidates(league.id) as member (member.member)}
											<option value={member.member}>{memberHandle(member.member)}</option>
										{/each}
									</select>
								</label>
							{/if}
						{:else if draft?.action === 'delete'}
							{#if draft.deleteConfirmed}
								<p class="del-league-armed">
									{t({ locale: $localeStore, key: 'settings.delete.leagues_delete_armed' })}
								</p>
							{:else}
								<div class="del-league-confirm">
									<p class="del-league-confirm-text">
										{t({
											locale: $localeStore,
											key: 'settings.delete.leagues_delete_confirm',
											params: { count: league.memberCount }
										})}
										<span class="del-league-confirm-sub">
											{t({ locale: $localeStore, key: 'settings.delete.leagues_delete_no_rejoin' })}
										</span>
									</p>
									<button
										class="del-league-confirm-btn"
										onclick={() =>
											(resolutions = {
												...resolutions,
												[league.id]: { ...draft, deleteConfirmed: true }
											})}
										type="button"
									>
										{t({ locale: $localeStore, key: 'settings.delete.leagues_delete' })}
									</button>
								</div>
							{/if}
						{/if}
					</div>
				{/each}
			</div>

			<div class="del-actions">
				<Button onclick={() => (step = 'what-happens')} variant="ghost"
					>{t({ locale: $localeStore, key: 'settings.delete.back' })}</Button
				>

				<Button
					class="del-danger-btn"
					onclick={enterConfirm}
					status={allLeaguesResolved ? 'enabled' : 'disabled'}
					variant="danger"
				>
					{t({ locale: $localeStore, key: 'settings.delete.continue' })}
					<ArrowRight aria-hidden="true" size={16} strokeWidth={1.8} />
				</Button>
			</div>
		</div>
	{:else if step === 'confirm'}
		<div class="del">
			<h2 class="del-title" data-tone="danger">
				{t({ locale: $localeStore, key: 'settings.delete.confirm_heading' })}
			</h2>

			<div class="del-finality">
				<p class="del-finality-title">
					{t({ locale: $localeStore, key: 'settings.delete.confirm_finality_title' })}
				</p>
				<p class="del-finality-body">
					{t({ locale: $localeStore, key: 'settings.delete.confirm' })}
				</p>
			</div>

			<label class="del-confirm-wrap">
				<span class="del-confirm-label">
					{t({ locale: $localeStore, key: 'settings.delete.confirm_type' })}
				</span>
				<div
					class="del-confirm-field"
					class:is-matched={handleMatches}
					class:is-mismatch={typedHandle.trim().length > 0 && !handleMatches}
				>
					<span class="del-confirm-at" aria-hidden="true">@</span>
					<input
						bind:this={confirmInputEl}
						class="del-confirm-input num"
						autocapitalize="off"
						autocomplete="off"
						autocorrect="off"
						disabled={inFlight}
						placeholder={nickname}
						spellcheck="false"
						type="text"
						bind:value={typedHandle}
					/>
					{#if handleMatches}
						<span class="del-confirm-tick" aria-hidden="true">
							<Check size={14} strokeWidth={2.5} />
						</span>
					{/if}
				</div>
			</label>
			<p class="del-confirm-hint">
				{t({ locale: $localeStore, key: 'settings.delete.confirm_exactly' })}
				<span class="del-confirm-hint-acc">{nickname}</span>
			</p>

			{#if typedHandle.trim().length > 0 && !handleMatches}
				<p class="del-error" role="alert">
					{t({ locale: $localeStore, key: 'settings.delete.confirm_mismatch' })}
				</p>
			{/if}

			{#if nonNullish(errorKey)}
				<p class="del-error" role="alert">
					{t({ locale: $localeStore, key: errorKey, params: errorParams })}
				</p>
			{/if}

			<div class="del-actions">
				<Button
					onclick={() => (step = ownedLeagueCount > 0 ? 'leagues' : 'what-happens')}
					status={inFlight ? 'disabled' : 'enabled'}
					variant="ghost"
				>
					{t({ locale: $localeStore, key: 'settings.delete.back' })}
				</Button>
				<Button
					class="del-danger-btn"
					onclick={runDelete}
					status={handleMatches ? deleteStatus : 'disabled'}
					variant="danger"
				>
					{#snippet busyLabel()}
						{t({ locale: $localeStore, key: 'settings.delete.deleting' })}
					{/snippet}
					{#if nonNullish(errorKey)}
						{t({ locale: $localeStore, key: 'settings.delete.try_again' })}
					{:else}
						{t({ locale: $localeStore, key: 'settings.delete.forever' })}
					{/if}
				</Button>
			</div>
		</div>
	{/if}
</BottomSheet>

{#if isOpen && step === 'gone'}
	<div class="del-gone-scrim" role="presentation">
		<div
			bind:this={goneDialogEl}
			class="del-gone"
			aria-describedby="del-gone-lede"
			aria-labelledby="del-gone-vale"
			aria-modal="true"
			role="dialog"
			tabindex="-1"
		>
			<span class="del-gone-eyebrow">
				{t({ locale: $localeStore, key: 'settings.delete.gone_eyebrow' })}
			</span>
			<p id="del-gone-vale" class="del-gone-vale">
				{t({ locale: $localeStore, key: 'settings.delete.gone_heading' })}
			</p>
			<p id="del-gone-lede" class="del-gone-lede">
				{t({ locale: $localeStore, key: 'settings.delete.gone_body' })}
			</p>
			<p class="del-gone-sub">{t({ locale: $localeStore, key: 'settings.delete.gone_sub' })}</p>
			<div class="del-gone-recovery">
				{t({ locale: $localeStore, key: 'settings.delete.gone_recover' })}
			</div>
			<button class="del-gone-cta" onclick={finish} type="button">
				{t({ locale: $localeStore, key: 'settings.delete.gone_return_label' })}
				{#if countdown > 0}
					<span class="del-gone-counter num">{countdown}</span>
				{/if}
			</button>
		</div>
	</div>
{/if}

<style lang="postcss">
	.del {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.25rem 0.1rem 0.4rem;
	}

	.del-title {
		margin: 0;
		font-size: var(--t-18);
		font-weight: 600;
		letter-spacing: var(--tracking-snug);
		color: var(--text-base);
	}

	/* Steps past the empathetic opener carry the danger tone in their
	   heading so the destructive intent reads from the title down. */
	.del-title[data-tone='danger'] {
		color: var(--danger);
	}

	.del-body {
		margin: 0;
		font-size: var(--t-13);
		line-height: 1.5;
		color: var(--text-muted);
	}

	/* Serif-italic lede — the empathetic voice for the opener and the
	   honest-disclosure intro. */
	.del-lede {
		margin: 0 0 0.15rem;
		font-family: var(--font-serif, serif);
		font-size: var(--t-13);
		font-style: italic;
		line-height: 1.45;
		color: var(--fg-dim);
	}

	.del-lede-acc {
		color: var(--accent);
	}

	.del-lede-danger {
		color: var(--danger);
		font-style: normal;
	}

	/* Reason picker — 2-col grid of soft-square chips. Active state
	   adopts the laurel accent (the empathetic step stays warm; the
	   danger tone is reserved for the steps past the opener). */
	.del-reasons {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.4rem;
	}

	.del-reason {
		padding: 0.6rem 0.65rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-8);
		background: var(--bg-surface);
		color: var(--text-base);
		font-size: var(--t-12);
		text-align: left;
		cursor: pointer;
		transition:
			border-color var(--d-hover) var(--ease-vici),
			background-color var(--d-hover) var(--ease-vici),
			color var(--d-hover) var(--ease-vici);
	}

	.del-reason.is-active {
		border-color: color-mix(in srgb, var(--accent) 40%, transparent);
		background: color-mix(in srgb, var(--accent) 10%, var(--bg-surface));
		color: var(--accent);
		font-weight: 600;
	}

	.del-note {
		width: 100%;
		min-height: 4rem;
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-8);
		background: var(--bg-surface);
		color: var(--text-base);
		font-family: inherit;
		font-size: var(--t-12);
		resize: vertical;
	}

	/* Retention off-ramp — dashed laurel-tinted card, sits above the
	   footer so the "stay" path is offered before the user commits. */
	.del-retain {
		padding: 0.65rem 0.7rem;
		border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
		border-radius: var(--r-12);
		background: color-mix(in srgb, var(--accent) 4%, transparent);
	}

	.del-retain-head {
		margin: 0 0 0.25rem;
		font-family: var(--font-serif, serif);
		font-size: var(--t-14);
		font-style: italic;
		font-weight: 600;
		color: var(--accent);
	}

	.del-retain-body {
		margin: 0 0 0.5rem;
		font-size: var(--t-12);
		line-height: 1.45;
		color: var(--text-muted);
	}

	.del-retain-actions {
		display: flex;
		gap: 0.4rem;
	}

	.del-retain-btn {
		flex: 1;
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		background: transparent;
		color: var(--text-base);
		font-size: var(--t-12);
		font-weight: 600;
		text-align: center;
		text-decoration: none;
		cursor: pointer;
		transition:
			border-color var(--d-hover) var(--ease-vici),
			background-color var(--d-hover) var(--ease-vici);
	}

	.del-retain-btn:hover {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--border-base));
		background: color-mix(in srgb, var(--accent) 8%, transparent);
	}

	/* Disclosure rows — icon + text, divider-separated. The ok rows take
	   a laurel-green tick; the rows the user can't make reversible (active
	   trades, owned leagues) take a danger bang. */
	.del-rows {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.del-row {
		display: grid;
		grid-template-columns: 1.375rem 1fr;
		gap: 0.6rem;
		padding: 0.75rem 0;
		border-top: 1px solid var(--border-base);
	}

	.del-row[data-first='true'] {
		border-top: 0;
	}

	.del-row-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1.375rem;
		height: 1.375rem;
		margin-top: 0.0625rem;
		border-radius: 50%;
	}

	.del-row-icon[data-tone='ok'] {
		border: 1px solid color-mix(in srgb, var(--yes) 40%, transparent);
		background: color-mix(in srgb, var(--yes) 10%, transparent);
		color: var(--yes);
	}

	.del-row-icon[data-tone='danger'] {
		border: 1px solid color-mix(in srgb, var(--danger) 50%, transparent);
		background: color-mix(in srgb, var(--danger) 10%, transparent);
		color: var(--danger);
	}

	.del-row-bang {
		font-family: var(--font-mono, monospace);
		font-size: var(--t-12);
		font-weight: 700;
		line-height: 1;
	}

	.del-row-text {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.del-row-label {
		font-size: var(--t-13);
		font-weight: 600;
		line-height: 1.3;
		color: var(--text-base);
	}

	.del-row-sub {
		font-size: var(--t-12);
		line-height: 1.45;
		color: var(--fg-dim);
	}

	/* Leagues resolution ---------------------------------------------- */
	.del-leagues {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.del-league {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.7rem 0.75rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: var(--bg-surface);
	}

	.del-league.is-resolved {
		border-color: color-mix(in srgb, var(--yes) 30%, var(--border-base));
	}

	.del-league-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.del-league-id {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.del-league-name {
		font-size: var(--t-13);
		font-weight: 600;
		color: var(--text-base);
	}

	.del-league-meta {
		font-family: var(--font-mono, monospace);
		font-size: var(--t-11);
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.del-league-tick {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 50%;
		background: var(--yes);
		color: var(--ink);
	}

	.del-league-modes {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.4rem;
	}

	.del-league-mode {
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-8);
		background: transparent;
		color: var(--fg-dim);
		font-size: var(--t-12);
		font-weight: 600;
		cursor: pointer;
		transition:
			border-color var(--d-hover) var(--ease-vici),
			background-color var(--d-hover) var(--ease-vici),
			color var(--d-hover) var(--ease-vici);
	}

	.del-league-mode:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.del-league-mode.is-transfer {
		border-color: color-mix(in srgb, var(--accent) 40%, transparent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		color: var(--accent);
	}

	.del-league-mode.is-delete {
		border-color: color-mix(in srgb, var(--danger) 40%, transparent);
		background: color-mix(in srgb, var(--danger) 10%, transparent);
		color: var(--danger);
	}

	.del-league-select-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.del-league-select-label {
		font-size: var(--t-11);
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.del-league-select {
		width: 100%;
		padding: 0.5rem 0.6rem;
		border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border-base));
		border-radius: var(--r-8);
		background: color-mix(in srgb, var(--ink-deep) 40%, transparent);
		color: var(--text-base);
		font-family: var(--font-mono, monospace);
		font-size: var(--t-12);
	}

	.del-league-empty {
		margin: 0;
		font-size: var(--t-12);
		color: var(--danger);
	}

	/* Inline disband confirm — text + danger pill, mirrors the source's
	   two-tap guard before a league is wiped for all members. */
	.del-league-confirm {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 0.65rem;
		border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
		border-radius: var(--r-8);
		background: color-mix(in srgb, var(--danger) 6%, transparent);
	}

	.del-league-confirm-text {
		flex: 1;
		margin: 0;
		font-size: var(--t-12);
		line-height: 1.4;
		color: var(--text-base);
	}

	.del-league-confirm-sub {
		display: block;
		color: var(--text-muted);
	}

	.del-league-confirm-btn {
		flex-shrink: 0;
		padding: 0.4rem 0.7rem;
		border: 0;
		border-radius: var(--r-8);
		background: var(--danger);
		color: #fff;
		font-family: inherit;
		font-size: var(--t-12);
		font-weight: 600;
		cursor: pointer;
	}

	.del-league-armed {
		margin: 0;
		font-size: var(--t-12);
		font-weight: 600;
		color: var(--danger);
	}

	/* Confirm ---------------------------------------------------------- */
	.del-finality {
		padding: 0.7rem 0.8rem;
		border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
		border-radius: var(--r-12);
		background: color-mix(in srgb, var(--danger) 6%, transparent);
	}

	.del-finality-title {
		margin: 0 0 0.25rem;
		font-family: var(--font-serif, serif);
		font-size: var(--t-16);
		font-style: italic;
		font-weight: 600;
		line-height: 1.3;
		color: var(--danger);
	}

	.del-finality-body {
		margin: 0;
		font-size: var(--t-12);
		line-height: 1.5;
		color: var(--text-muted);
	}

	.del-confirm-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.del-confirm-label {
		font-family: var(--font-mono, monospace);
		font-size: var(--t-11);
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.del-confirm-field {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0 0.7rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-8);
		background: var(--bg-surface);
		transition: border-color var(--d-hover) var(--ease-vici);
	}

	.del-confirm-field.is-matched {
		border-color: var(--yes);
	}

	.del-confirm-field.is-mismatch {
		border-color: color-mix(in srgb, var(--danger) 40%, transparent);
	}

	.del-confirm-at {
		flex-shrink: 0;
		font-family: var(--font-serif, serif);
		font-size: var(--t-18);
		font-style: italic;
		color: var(--text-muted);
	}

	.del-confirm-input {
		flex: 1;
		min-width: 0;
		padding: 0.55rem 0;
		border: 0;
		background: transparent;
		color: var(--text-base);
		font-family: var(--font-mono, monospace);
		font-size: var(--t-14);
	}

	.del-confirm-input:focus {
		outline: none;
	}

	.del-confirm-input:disabled {
		opacity: 0.5;
	}

	.del-confirm-tick {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--yes);
	}

	.del-confirm-hint {
		margin: 0;
		font-family: var(--font-mono, monospace);
		font-size: var(--t-11);
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.del-confirm-hint-acc {
		color: var(--accent);
	}

	.del-error {
		margin: 0;
		font-size: var(--t-12);
		color: var(--danger);
	}

	/* Footer actions --------------------------------------------------- */
	.del-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.15rem;
	}

	.del-actions :global(button) {
		flex: 1;
	}

	/* Destructive footer CTA — the `danger` Button variant wires to the
	   prediction-NO red; the delete flow's terracotta danger ramp is the
	   correct destructive-action tone, so override the fill here. */
	:global(.del-danger-btn) {
		background: var(--danger);
		color: #fff;
	}

	:global(.del-danger-btn:hover) {
		background: var(--danger-deep);
	}

	/* Gone — full-bleed Vale takeover, layered above the sheet so it
	   reads as a final farewell rather than another sheet beat. No
	   backdrop-click / Escape close: the only way out is the CTA (or the
	   auto-redirect when the counter reaches zero). */
	.del-gone-scrim {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		padding: 0 1.75rem;
		text-align: center;
		background: var(--ink-deep);
		animation: del-gone-fade-in var(--d-state) ease-out both;
	}

	.del-gone {
		display: flex;
		flex-direction: column;
		align-items: center;
		max-width: 22rem;
	}

	.del-gone-eyebrow {
		margin-bottom: 0.5rem;
		font-family: var(--font-mono, monospace);
		font-size: var(--t-11);
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.del-gone-vale {
		margin: 0 0 0.85rem;
		font-family: var(--font-serif, serif);
		font-size: var(--t-44);
		font-style: italic;
		line-height: 1;
		color: var(--accent);
	}

	.del-gone-lede {
		margin: 0 0 0.25rem;
		font-size: var(--t-14);
		line-height: 1.5;
		color: var(--text-base);
	}

	.del-gone-sub {
		margin: 0.35rem 0 1.4rem;
		font-size: var(--t-12);
		line-height: 1.5;
		color: var(--text-muted);
	}

	.del-gone-recovery {
		margin-bottom: 1.1rem;
		padding: 0.7rem 1rem;
		border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
		border-radius: var(--r-8);
		background: color-mix(in srgb, var(--accent) 4%, transparent);
		font-size: var(--t-12);
		line-height: 1.5;
		color: var(--text-base);
	}

	.del-gone-cta {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.75rem 1.4rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		background: var(--bg-surface);
		color: var(--text-base);
		font-family: inherit;
		font-size: var(--t-13);
		font-weight: 500;
		cursor: pointer;
		transition:
			border-color var(--d-hover) var(--ease-vici),
			background-color var(--d-hover) var(--ease-vici);
	}

	.del-gone-cta:hover {
		border-color: var(--border-strong);
	}

	.del-gone-counter {
		color: var(--text-muted);
	}

	@keyframes del-gone-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.del-gone-scrim {
			animation: none;
		}
	}
</style>
