<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { untrack } from 'svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import {
		COACH_FLOW_SEEN_KEY,
		COACH_ONBOARDING_SEEN_KEY
	} from '#lib/utils/onboarding-flags.utils.ts';
	import { browser } from '$app/env';

	/**
	 * FlowCoach — first-run gesture map shown the first time any user
	 * reaches the prediction card (the deck is open to guests too). It is
	 * a NON-BLOCKING overlay: the card below stays fully readable and
	 * swipeable, and only the opt-out button captures pointer events. The
	 * coach teaches by doing — it does not hijack the card, run a timer,
	 * or drift the deck.
	 *
	 * Dismissal is learn-by-doing: the coach clears itself the moment the
	 * user places their FIRST real call, reacting to the `commitSignal`
	 * counter. The deck only bumps that counter on a committed YES / NO,
	 * which is reachable only when signed in — so for guests the "Got it"
	 * opt-out is the dismissal path. On the first commit it flashes a
	 * short confirmation, then unmounts; "Got it" dismisses immediately,
	 * without the flash. Either path persists the seen flag so the coach
	 * never reappears.
	 *
	 * `surface` selects which dismissal flag persists in `localStorage`
	 * (shown at most once per device, per surface). Both surfaces share the
	 * same redesign and the same first-commit dismissal signal.
	 */
	interface Props {
		surface?: 'flow' | 'onboarding';
		/**
		 * Monotonic counter the deck bumps on every committed YES / NO. The
		 * coach captures its value when it becomes visible and dismisses as
		 * soon as it advances past that baseline — the user's first real call.
		 */
		commitSignal?: number;
	}

	const { surface = 'flow', commitSignal = 0 }: Props = $props();

	const storageKey = $derived(
		surface === 'onboarding' ? COACH_ONBOARDING_SEEN_KEY : COACH_FLOW_SEEN_KEY
	);

	const readSeen = (): boolean => {
		if (!browser) {
			return false;
		}

		try {
			return Boolean(localStorage.getItem(storageKey));
		} catch {
			return false;
		}
	};

	let visible = $state(!readSeen());
	let confirming = $state(false);

	// Baseline commit count at mount. The coach only ever mounts for a
	// not-yet-seen user, so this is the count before their first real call;
	// the next commit past it dismisses the coach. `untrack` snapshots the
	// prop once at init without registering a reactive read.
	const commitBaseline = untrack(() => commitSignal);

	let confirmTimer: ReturnType<typeof setTimeout> | null = null;

	const persistSeen = () => {
		if (!browser) {
			return;
		}

		try {
			localStorage.setItem(storageKey, '1');
		} catch {
			// localStorage write blocked — accept the loss; the coach will
			// reappear next session for this device.
		}
	};

	const dismiss = () => {
		persistSeen();
		visible = false;
	};

	const confirmThenDismiss = () => {
		persistSeen();
		confirming = true;
		confirmTimer = setTimeout(() => {
			visible = false;
		}, 1150);
	};

	$effect(() => {
		if (!visible || confirming) {
			return;
		}

		if (commitSignal > commitBaseline) {
			confirmThenDismiss();
		}
	});

	$effect(() => () => {
		if (nonNullish(confirmTimer)) {
			clearTimeout(confirmTimer);
		}
	});

	const tr = (key: MessageKey): string => t({ locale: $localeStore, key });
</script>

{#if visible}
	<div
		class="flow-coach"
		class:is-confirming={confirming}
		aria-label={tr('flow.coach.aria')}
		aria-modal="false"
		role="dialog"
	>
		{#if confirming}
			<div class="fc-confirm">
				<span class="fc-confirm-check" aria-hidden="true">
					<svg
						fill="none"
						height="17"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2.6"
						viewBox="0 0 24 24"
						width="17"><path d="m5 12 5 5L20 7"></path></svg
					>
				</span>
				<span class="fc-confirm-text">{tr('flow.coach.confirm')}</span>
			</div>
		{:else}
			<div class="fc-map">
				<p class="fc-head">{tr('flow.coach.head')}</p>

				<div class="fc-cross">
					<div class="fc-arm fc-arm-skip fc-secondary">
						<span class="fc-glyph" aria-hidden="true">↑</span>
						<span class="fc-label">{tr('flow.coach.skip')}</span>
						<span class="fc-sub">{tr('flow.coach.skip_sub')}</span>
					</div>

					<div class="fc-row">
						<div class="fc-arm fc-arm-no fc-primary">
							<span class="fc-glyph" aria-hidden="true">←</span>
							<span class="fc-label">{tr('flow.coach.no')}</span>
							<span class="fc-sub">{tr('flow.coach.no_sub')}</span>
						</div>

						<div class="fc-arm fc-arm-tap fc-secondary">
							<span class="fc-glyph" aria-hidden="true">
								<svg
									fill="none"
									height="20"
									stroke="currentColor"
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="1.8"
									viewBox="0 0 24 24"
									width="20"
								>
									<path d="M9 11V6a2 2 0 0 1 4 0v5"></path>
									<path
										d="M13 11V8.5a2 2 0 0 1 4 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.5 15a1.7 1.7 0 0 1 2.8-1.9l1.2 1.4"
									></path>
								</svg>
							</span>
							<span class="fc-sub">{tr('flow.coach.tap_sub')}</span>
						</div>

						<div class="fc-arm fc-arm-yes fc-primary">
							<span class="fc-glyph" aria-hidden="true">→</span>
							<span class="fc-label">{tr('flow.coach.yes')}</span>
							<span class="fc-sub">{tr('flow.coach.yes_sub')}</span>
						</div>
					</div>
				</div>

				<button class="fc-optout" onclick={dismiss} type="button">
					{tr('flow.coach.got_it')}
				</button>
			</div>
		{/if}
	</div>
{/if}

<style lang="postcss">
	/* Non-blocking scrim: the card below stays readable and swipeable, so
	   the overlay itself ignores pointer events — only the opt-out button
	   (and the confirm flash) opt back in. */
	.flow-coach {
		position: absolute;
		inset: 0;
		z-index: 40;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 24px;
		pointer-events: none;
		border-radius: inherit;
		animation: fc-fade-in 320ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.fc-map {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 18px;
		max-width: 22rem;
		text-align: center;
	}

	.fc-head {
		margin: 0;
		font-family: var(--font-serif);
		font-style: italic;
		font-size: var(--text-h2);
		line-height: 1.2;
		color: var(--text-base);
		text-shadow:
			0 2px 12px rgba(14, 13, 11, 0.85),
			0 0 24px rgba(14, 13, 11, 0.7);
	}

	:global([data-theme='light']) .fc-head,
	:global([data-theme='peach']) .fc-head {
		text-shadow:
			0 1px 10px color-mix(in srgb, var(--bg-surface) 92%, transparent),
			0 0 20px color-mix(in srgb, var(--bg-surface) 85%, transparent);
	}

	.fc-cross {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
	}

	.fc-row {
		display: flex;
		align-items: flex-start;
		justify-content: center;
		gap: 20px;
	}

	.fc-arm {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		min-width: 4.25rem;
		padding: 10px 12px;
		border-radius: var(--radius-nav, 14px);
		border: 1px solid var(--border-base);
		background: color-mix(in srgb, var(--bg-popover) 78%, transparent);
		-webkit-backdrop-filter: blur(10px);
		backdrop-filter: blur(10px);
	}

	.fc-secondary {
		opacity: 0.72;
		border-color: color-mix(in srgb, var(--border-base) 70%, transparent);
	}

	.fc-glyph {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 22px;
		font-family: 'Söhne', system-ui, sans-serif;
		font-size: 20px;
		font-weight: 700;
		line-height: 1;
		color: var(--text-base);
	}

	.fc-label {
		font-family: var(--font-mono);
		font-size: 15px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.fc-sub {
		font-size: 11px;
		line-height: 1.25;
		color: var(--text-muted);
	}

	/* YES / NO are the committing actions — full token color carries the
	   visual weight; SKIP / TAP stay neutral and de-emphasized. */
	.fc-arm-yes .fc-glyph,
	.fc-arm-yes .fc-label {
		color: var(--yes);
	}

	.fc-arm-yes {
		border-color: color-mix(in srgb, var(--yes) 45%, var(--border-base));
		background: color-mix(in srgb, var(--yes) 12%, var(--bg-popover) 78%);
	}

	.fc-arm-no .fc-glyph,
	.fc-arm-no .fc-label {
		color: var(--no);
	}

	.fc-arm-no {
		border-color: color-mix(in srgb, var(--no) 45%, var(--border-base));
		background: color-mix(in srgb, var(--no) 12%, var(--bg-popover) 78%);
	}

	.fc-arm-tap .fc-glyph {
		color: var(--text-muted);
	}

	.fc-optout {
		pointer-events: auto;
		appearance: none;
		margin-top: 2px;
		padding: 8px 20px;
		border: 1px solid var(--border-strong);
		border-radius: var(--r-pill, 999px);
		background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
		color: var(--text-base);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		-webkit-backdrop-filter: blur(10px);
		backdrop-filter: blur(10px);
		transition:
			background 180ms var(--ease-vici, ease),
			border-color 180ms var(--ease-vici, ease);
	}

	.fc-optout:hover {
		background: var(--bg-surface);
		border-color: var(--color-accent);
	}

	.fc-optout:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.fc-confirm {
		pointer-events: auto;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 12px 18px;
		border: 1px solid color-mix(in srgb, var(--yes) 45%, var(--border-base));
		border-radius: var(--r-pill, 999px);
		background: color-mix(in srgb, var(--yes) 14%, var(--bg-popover) 82%);
		color: var(--text-base);
		font-size: 14px;
		font-weight: 600;
		-webkit-backdrop-filter: blur(12px);
		backdrop-filter: blur(12px);
		animation: fc-confirm-in 280ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.fc-confirm-check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: var(--r-pill, 999px);
		background: color-mix(in srgb, var(--yes) 22%, transparent);
		color: var(--yes);
	}

	@keyframes fc-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes fc-confirm-in {
		from {
			opacity: 0;
			transform: translateY(6px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.flow-coach,
		.fc-confirm {
			animation: none;
		}

		.fc-optout {
			transition: none;
		}
	}
</style>
