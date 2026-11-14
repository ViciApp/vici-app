<script lang="ts">
	import { Eye, Gift } from '@lucide/svelte/icons';
	import { onMount, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import SignInProviderStack from '#lib/components/authn/SignInProviderStack.svelte';
	import { HANDLE_POOL } from '#lib/constants/handle-pool.constants.ts';
	import {
		MAX_NICKNAME_LENGTH,
		MIN_NICKNAME_LENGTH,
		NICKNAME_PATTERN,
		RESERVED_HANDLES,
		sanitizeNickname
	} from '#lib/constants/profile.constants.ts';
	import { TestId } from '#lib/constants/test-ids.constants.ts';
	import { newUserVxpAmountMilestone1BaseUnits } from '#lib/constants/vxp-onboarding.constants.ts';
	import { featuredEvent } from '#lib/derived/featured-event.derived.ts';
	import { track } from '#lib/services/analytics.services.ts';
	import { checkNicknameAvailability } from '#lib/services/profile.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { formatVxpBalance } from '#lib/utils/playground-display.utils.ts';

	/**
	 * One-screen onboarding: claim a handle and sign up on a single
	 * surface: brand wordmark → hero → handle field (live availability +
	 * pool-suggested placeholder) → reward chip → auth provider stack →
	 * escapes → legal fine print.
	 *
	 * Handle behaviour: live probe, monotonic cancel token, session-taken
	 * cache, offline-tolerant `failed`, and a claim-time TOCTOU re-check.
	 * Team selection happens in the post-signup Profile instead, so
	 * `participantId` / `side` are always `null` in the emitted handoff and
	 * the persist-across-providers stash/drain is reused unchanged.
	 *
	 * Emits the handoff shape the signup page consumes, so its pre-auth
	 * stash and authenticated direct-write need no signature change.
	 */
	interface Props {
		// Fires after the provider stack resolves in-page (non-redirect).
		onComplete: (result: {
			participantId: string | null;
			side: 'YES' | 'NO' | null;
			handle: string | null;
		}) => void;
		// Fires once an available handle is claimed, BEFORE any provider runs,
		// so a full-page redirect provider (Google) carries the handle
		// through the auth-gate stash.
		onPicksReady?: (result: {
			participantId: string | null;
			side: 'YES' | 'NO' | null;
			handle: string | null;
		}) => void;
		// "Already a member? Sign in".
		onSignIn: () => void;
		// "Skip: preview first, sign up later". Carries the selected handle so
		// the guest session (and the later conversion) keeps the chosen name.
		onSkip: (handle: string | null) => void;
		// True when the user is already signed in (post-signin onboarding path).
		authenticated?: boolean;
	}

	const { onComplete, onPicksReady, onSignIn, onSkip, authenticated = false }: Props = $props();

	const event = $derived($featuredEvent);

	// Starter-pack VXP: sourced from the real registration milestone grant
	// rather than a hardcoded literal, so the chip stays in lock-step with
	// the economy config.
	const starterVxp = $derived(formatVxpBalance({ value: newUserVxpAmountMilestone1BaseUnits() }));
	const eventTitle = $derived(event.brandedTitle ?? event.shortTitle ?? event.title);

	// Placeholder typewriter cadence: reveal a word, hold it, retract it,
	// reveal the next.
	const PLACEHOLDER_CYCLE_LENGTH = 6;
	const TYPE_SPEED_MS = 95;
	const DELETE_SPEED_MS = 45;
	const SETTLED_PAUSE_MS = 2200;
	const EMPTY_PAUSE_MS = 550;
	const FOCUS_POLL_MS = 500;

	// Pick `count` distinct entries from the handle pool (sampling without
	// replacement off a throwaway copy).
	const sampleHandlePool = (count: number): string[] => {
		const remaining = [...HANDLE_POOL];
		const limit = Math.min(count, remaining.length);
		const picks: string[] = [];

		while (picks.length < limit) {
			const i = Math.floor(Math.random() * remaining.length);
			picks.push(remaining.splice(i, 1)[0]);
		}

		return picks;
	};

	// A rotating set of pool picks, revealed one at a time as a
	// typewriter-animated placeholder. Every entry already satisfies the
	// handle validator, so whichever word is settled in the field is
	// directly claimable (tabbing away / submitting an empty field claims
	// it). Sampled once at init.
	const placeholderCycle = sampleHandlePool(PLACEHOLDER_CYCLE_LENGTH);

	// The settled cycle word: the placeholder's claim target and the
	// `@name` preview. It advances to the next word only once that word is
	// visibly being typed, so the preview never names a handle the field
	// hasn't shown.
	let suggestion = $state(placeholderCycle[0]);

	// The live placeholder fragment the typewriter reveals then retracts,
	// and whether the animation is running (a no-op under reduced motion or
	// a single-word pool, where the placeholder stays the settled word).
	let typedPlaceholder = $state(placeholderCycle[0]);
	let isTyping = $state(false);

	// Pause the cycle while the field is engaged.
	let isFocused = $state(false);

	const placeholderText = $derived(isTyping && !isFocused ? `${typedPlaceholder}|` : suggestion);

	let custom = $state('');

	// Sanitised view of the input: NFC-normalised, out-of-charset characters
	// stripped (case and accents are preserved; uniqueness folds them later).
	// The input renders this cleaned value, and it is what gets probed and
	// claimed. An empty field falls back to the pool suggestion.
	const cleaned = $derived(sanitizeNickname(custom));
	const selectedName = $derived(cleaned.length > 0 ? cleaned : suggestion);
	// Whether the active selection is the pool placeholder (empty input). The
	// suggestion is pre-validated and not user-typed, so it never fires a
	// `handle_checked` event.
	const usingSuggestion = $derived(cleaned.length === 0);

	type LiveAvailability = 'idle' | 'checking' | 'available' | 'taken' | 'failed';
	let liveAvailability = $state<LiveAvailability>('idle');
	let checkToken = 0;
	let checkTimer: ReturnType<typeof setTimeout> | undefined;
	const CHECK_DEBOUNCE_MS = 350;

	// Handles the satellite confirmed taken this session: sourced from the
	// live probe and the claim-time re-check, so a retry doesn't re-query.
	const sessionTaken = new SvelteSet<string>();
	let isClaiming = $state(false);
	// Set when the claim-time re-check finds the handle was taken between
	// display and submit. Cleared on the next input change.
	let claimError = $state<'taken' | null>(null);

	const onInput = (e: Event) => {
		if (e.currentTarget instanceof HTMLInputElement) {
			custom = e.currentTarget.value;
		}
	};

	// Clear the claim-time error whenever the typed handle changes.
	$effect(() => {
		void cleaned;
		untrack(() => {
			claimError = null;
		});
	});

	// Local format checks the live probe must clear before hitting the
	// satellite. Only the typed handle is probed; the placeholder is
	// pre-validated.
	const formatValid = $derived(
		!usingSuggestion &&
			selectedName.length >= MIN_NICKNAME_LENGTH &&
			selectedName.length <= MAX_NICKNAME_LENGTH &&
			NICKNAME_PATTERN.test(selectedName) &&
			!RESERVED_HANDLES.has(selectedName.toLowerCase())
	);

	// Debounced live probe. A monotonic token cancels the in-flight check on
	// each keystroke so stale results drop. Offline-tolerant: a failure
	// surfaces as `failed` but never blocks the claim; the claim-time
	// re-check and the satellite assertion are the authority. Fires
	// `handle_checked` once a typed-handle probe completes.
	$effect(() => {
		const candidate = selectedName;
		const probe = formatValid;

		if (checkTimer) {
			clearTimeout(checkTimer);
		}

		checkToken += 1;
		const token = checkToken;

		if (!probe) {
			liveAvailability = 'idle';

			return;
		}

		if (sessionTaken.has(candidate)) {
			liveAvailability = 'taken';
			track({ name: 'handle_checked', source: 'onboarding', ok: false });

			return;
		}

		liveAvailability = 'checking';

		checkTimer = setTimeout(() => {
			void (async () => {
				try {
					const res = await checkNicknameAvailability({ nickname: candidate });

					if (token !== checkToken) {
						return;
					}

					if (res.available) {
						liveAvailability = 'available';
					} else {
						sessionTaken.add(candidate);
						liveAvailability = 'taken';
					}

					track({
						name: 'handle_checked',
						source: 'onboarding',
						ok: res.available
					});
				} catch (err) {
					if (token !== checkToken) {
						return;
					}

					console.warn(`Live availability check failed for "${candidate}":`, err);
					liveAvailability = 'failed';
				}
			})();
		}, CHECK_DEBOUNCE_MS);

		return () => {
			if (checkTimer) {
				clearTimeout(checkTimer);
			}
		};
	});

	interface Availability {
		// Whether the handle can be claimed.
		ok: boolean;
		// How to render the hint: confirmed-available (green), a hard error
		// (red), or a neutral in-between (probing / couldn't verify / the
		// pre-validated placeholder).
		tone: 'ok' | 'neutral' | 'error';
		reasonKey?: MessageKey;
	}

	const availability: Availability = $derived.by(() => {
		const name = selectedName;

		// The empty-field placeholder is a pre-validated pool pick: claimable,
		// shown neutral (it isn't a confirmed-available probe result).
		if (usingSuggestion) {
			return { ok: true, tone: 'neutral' };
		}

		if (name.length < MIN_NICKNAME_LENGTH) {
			return { ok: false, tone: 'error', reasonKey: 'onboarding.avail.too_short' };
		}

		if (name.length > MAX_NICKNAME_LENGTH) {
			return { ok: false, tone: 'error', reasonKey: 'onboarding.avail.too_long' };
		}

		if (!NICKNAME_PATTERN.test(name)) {
			return { ok: false, tone: 'error', reasonKey: 'onboarding.avail.invalid' };
		}

		if (RESERVED_HANDLES.has(name.toLowerCase())) {
			return { ok: false, tone: 'error', reasonKey: 'onboarding.avail.reserved' };
		}

		if (claimError === 'taken' || sessionTaken.has(name)) {
			return { ok: false, tone: 'error', reasonKey: 'onboarding.avail.taken' };
		}

		if (liveAvailability === 'idle' || liveAvailability === 'checking') {
			return { ok: false, tone: 'neutral', reasonKey: 'onboarding.avail.checking' };
		}

		if (liveAvailability === 'taken') {
			return { ok: false, tone: 'error', reasonKey: 'onboarding.avail.taken' };
		}

		// Probe failed: claimable but neutral; never the green "Available",
		// since it wasn't confirmed. The claim-time re-check is the gate.
		if (liveAvailability === 'failed') {
			return { ok: true, tone: 'neutral', reasonKey: 'onboarding.avail.check_failed' };
		}

		return { ok: true, tone: 'ok' };
	});

	const canClaim = $derived(availability.ok && !isClaiming);

	// Hand the claimed handle to the pre-auth stash before the provider
	// stack runs. Runs the claim-time TOCTOU re-check first so a handle
	// taken between display and submit surfaces inline rather than failing
	// at the satellite assertion. Team/side are always null for this flow.
	const stashHandle = async (): Promise<boolean> => {
		if (!availability.ok || !selectedName || isClaiming) {
			return false;
		}

		isClaiming = true;

		try {
			const res = await checkNicknameAvailability({ nickname: selectedName });

			if (!res.available) {
				sessionTaken.add(selectedName);
				claimError = 'taken';

				return false;
			}
		} catch (err) {
			// Fall through to stash: the satellite-side assertion is the
			// ultimate authority, and blocking on a transient probe failure
			// would strand the user.
			console.warn('Claim-time availability re-check failed:', err);
		} finally {
			isClaiming = false;
		}

		onPicksReady?.({ participantId: null, side: null, handle: selectedName });

		return true;
	};

	// Wrap the provider stack's success so the picks are stashed before
	// `onComplete` lands. For redirect providers the stash already happened
	// on focus-out / interaction below; this covers in-page providers.
	const onAuthSuccess = () => {
		onComplete({ participantId: null, side: null, handle: selectedName });
	};

	// Write the pre-auth onboarding stash SYNCHRONOUSLY the moment an available
	// handle is committed (input blur, or pointerdown on the auth surface), so
	// a full-page redirect provider (Google) carries it through: the stash must
	// already exist in `localStorage` before any provider handler can navigate
	// away. A previous async re-check here could lose the race and never write.
	// The post-sign-in drain re-probes the handle and resolves any TOCTOU
	// collision, so no claim-time re-check is needed on this path.
	const onCommitHandle = () => {
		if (!availability.ok || selectedName.length === 0) {
			return;
		}

		onPicksReady?.({ participantId: null, side: null, handle: selectedName });
	};

	const onFieldFocus = () => {
		isFocused = true;
	};

	const onFieldBlur = () => {
		isFocused = false;
		onCommitHandle();
	};

	const lockKey = $derived<MessageKey>(
		canClaim ? 'onboarding.lock_ready' : 'onboarding.lock_blocked'
	);

	// Skip into guest preview. Stash the claimed handle through the same
	// pre-auth pipeline a real sign-up uses, so a later conversion keeps the
	// chosen name, then hand the handle to the host to open the guest session.
	const onSkipPreview = () => {
		const handle = availability.ok ? selectedName : null;
		onCommitHandle();
		onSkip(handle);
	};

	onMount(() => {
		track({ name: 'onboarding_started', source: 'onboarding' });
	});

	// Drive the placeholder typewriter. Plain locals (not runes) hold the
	// loop cursor; only the rendered fragment and the settled word are
	// reactive. The settled `suggestion` advances as each new word starts
	// typing so the `@name` preview and the hint never drift apart. Honours
	// reduced motion by leaving the placeholder on the first settled word.
	onMount(() => {
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		if (reduceMotion || placeholderCycle.length <= 1) {
			return;
		}

		isTyping = true;

		let wordIndex = 0;
		let charIndex = placeholderCycle[0].length;
		let deleting = true;
		let timer: ReturnType<typeof setTimeout>;

		const tick = () => {
			// Hold while the user owns the field; the placeholder is hidden
			// behind typed text anyway, and the caret shouldn't compete with a
			// second blinking cursor on focus.
			if (isFocused || cleaned.length > 0) {
				timer = setTimeout(tick, FOCUS_POLL_MS);

				return;
			}

			const word = placeholderCycle[wordIndex];
			charIndex += deleting ? -1 : 1;
			typedPlaceholder = word.slice(0, charIndex);

			// Advance the claim target only once the new word is visibly being
			// typed, never during the blank beat, so a blur there commits the
			// word the user just saw, not the next one they haven't.
			if (!deleting && charIndex === 1) {
				suggestion = word;
			}

			let delay_ms = deleting ? DELETE_SPEED_MS : TYPE_SPEED_MS;

			if (!deleting && charIndex === word.length) {
				deleting = true;
				delay_ms = SETTLED_PAUSE_MS;
			} else if (deleting && charIndex === 0) {
				deleting = false;
				wordIndex = (wordIndex + 1) % placeholderCycle.length;
				delay_ms = EMPTY_PAUSE_MS;
			}

			timer = setTimeout(tick, delay_ms);
		};

		// Let the first word sit before the cycle starts retracting it.
		timer = setTimeout(tick, SETTLED_PAUSE_MS);

		return () => clearTimeout(timer);
	});
</script>

<div class="ob" data-tid={TestId.Onboarding}>
	<div class="ob-wrap">
		<div class="ob-body-wrap">
			<div class="ob-beat">
				<span class="ob-brand">{t({ locale: $localeStore, key: 'onboarding.brand' })}</span>

				<h1 id="onboarding-handle-heading" class="ob-h1">
					{t({ locale: $localeStore, key: 'onboarding.h1_pre' })}
					<span class="serif-italic acc">
						{t({ locale: $localeStore, key: 'onboarding.h1_accent' })}
					</span>
				</h1>
				<p class="ob-sub">{t({ locale: $localeStore, key: 'onboarding.sub' })}</p>

				<div class="ob-custom-input-wrap">
					<span class="ob-at-large">@</span>
					<input
						class="ob-custom-input"
						aria-labelledby="onboarding-handle-heading"
						autocapitalize="off"
						autocomplete="off"
						data-tid={TestId.OnboardingHandleInput}
						maxlength={MAX_NICKNAME_LENGTH}
						onblur={onFieldBlur}
						onfocus={onFieldFocus}
						oninput={onInput}
						placeholder={placeholderText}
						spellcheck="false"
						type="text"
						value={cleaned}
					/>
				</div>

				<div
					class="ob-avail"
					class:checking={availability.tone === 'neutral'}
					class:no={availability.tone === 'error'}
					class:ok={availability.tone === 'ok'}
					aria-live={usingSuggestion ? 'off' : 'polite'}
				>
					{#if availability.tone === 'ok'}
						{t({ locale: $localeStore, key: 'onboarding.avail.available' })}
						<span class="serif-italic">@{selectedName}</span>
					{:else if availability.reasonKey}
						{t({ locale: $localeStore, key: availability.reasonKey })}
					{:else}
						@{selectedName}
					{/if}
				</div>

				<div class="ob-summary ob-summary-starter">
					<div class="ob-summary-row">
						<span class="ob-summary-flag ob-summary-flag-starter">
							<Gift size={16} strokeWidth={1.7} />
						</span>
						<div>
							<div class="ob-summary-q">
								{t({ locale: $localeStore, key: 'onboarding.reward_title' })}
							</div>
							<div class="ob-summary-meta">
								{t({
									locale: $localeStore,
									key: 'onboarding.reward_sub',
									params: { event: eventTitle }
								})}
								· {starterVxp} VXP
							</div>
						</div>
					</div>
				</div>

				<div class="ob-lock" class:ready={canClaim}>
					{t({
						locale: $localeStore,
						key: lockKey,
						params: { handle: selectedName }
					})}
				</div>

				<div class="ob-auth-buttons">
					{#if authenticated}
						<button
							class="ob-btn-primary"
							data-tid={TestId.OnboardingPrimary}
							disabled={!canClaim}
							onclick={() => {
								void stashHandle().then((ok) => {
									if (ok) {
										onComplete({ participantId: null, side: null, handle: selectedName });
									}
								});
							}}
							type="button"
						>
							{t({ locale: $localeStore, key: 'onboarding.finish_cta' })}
						</button>
					{:else}
						<div onpointerdowncapture={onCommitHandle}>
							<SignInProviderStack
								disabled={!availability.ok}
								handle={selectedName}
								mode="signup"
								onSuccess={onAuthSuccess}
							/>
						</div>

						<button
							class="ob-guest-btn"
							data-tid={TestId.OnboardingHandleSkip}
							onclick={onSkipPreview}
							type="button"
						>
							<Eye aria-hidden="true" size={16} strokeWidth={1.7} />
							{t({ locale: $localeStore, key: 'onboarding.guest_cta' })}
						</button>
					{/if}
				</div>

				{#if authenticated}
					<button
						class="ob-skip-link"
						data-tid={TestId.OnboardingHandleSkip}
						onclick={onSkipPreview}
						type="button"
					>
						{t({ locale: $localeStore, key: 'onboarding.skip' })}
					</button>
				{:else}
					<p class="ob-guest-reassure">
						{t({ locale: $localeStore, key: 'onboarding.guest_reassure' })}
					</p>
				{/if}

				{#if !authenticated}
					<div class="ob-signin">
						{t({ locale: $localeStore, key: 'onboarding.signin_prompt' })}
						<button class="ob-signin-link" onclick={onSignIn} type="button">
							{t({ locale: $localeStore, key: 'onboarding.signin_link' })}
						</button>
					</div>
				{/if}

				<div class="ob-legal">
					<span>{t({ locale: $localeStore, key: 'onboarding.legal_currency' })}</span>
					<span>{t({ locale: $localeStore, key: 'onboarding.legal_resolution' })}</span>
				</div>
			</div>
		</div>
	</div>
</div>
