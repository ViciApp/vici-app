<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { tick, untrack } from 'svelte';
	import LandingClaimTray from '#lib/components/landing/LandingClaimTray.svelte';
	import { LANDING_CLAIM_CODE_LENGTH } from '#lib/constants/landing-claim.constants.ts';
	import { LandingClaimFlow } from '#lib/stores/landing-claim-flow.svelte.ts';
	import { landingClaimStore } from '#lib/stores/landing-claim.store.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingClaimStep, LandingClaimSubmit } from '#lib/types/landing-claim.ts';
	import { haptic } from '#lib/utils/haptics.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { landingClaimLine } from '#lib/utils/landing-claim.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';

	interface Props {
		submit: LandingClaimSubmit;
		// Width of the top-bar button the capsule widens out of.
		originWidth: number;
		claimedHandle?: string;
		onclaimed?: (handle: string) => void;
		// Where focus goes back to when the capsule closes from inside.
		onreturnfocus?: () => void;
	}

	const {
		submit,
		originWidth,
		claimedHandle,
		onclaimed = () => {},
		onreturnfocus = () => {}
	}: Props = $props();

	const STATUS_ID = 'landing-claim-status';

	const flow = new LandingClaimFlow(() => submit);

	let root = $state<HTMLDivElement>();
	let pill = $state<HTMLFormElement>();
	let handleInput = $state<HTMLInputElement>();
	let emailInput = $state<HTMLInputElement>();
	let codeInput = $state<HTMLInputElement>();
	let closeButton = $state<HTMLButtonElement>();

	const open = $derived($landingClaimStore.open);
	const shownStep = $derived<LandingClaimStep>(nonNullish(claimedHandle) ? 'done' : flow.step);
	const line = $derived(
		landingClaimLine({
			step: shownStep,
			handle: flow.handle,
			email: flow.email,
			check: flow.check,
			notice: flow.notice,
			ack: flow.typed ? undefined : $landingClaimStore.ack
		})
	);
	const ctaKey = $derived(flow.step === 'code' ? 'landing.claim.cta.claim' : 'signin.email.cta');

	const focusField = async () => {
		await tick();

		const field = { handle: handleInput, email: emailInput, code: codeInput, done: closeButton }[
			shownStep
		];

		field?.focus({ preventScroll: true });
	};

	const shake = () => {
		haptic('light-tap');

		if (prefersReducedMotion()) {
			return;
		}

		pill?.animate(
			[
				{ transform: 'translateX(0)' },
				{ transform: 'translateX(-6px)' },
				{ transform: 'translateX(6px)' },
				{ transform: 'translateX(0)' }
			],
			{ duration: 300 }
		);
	};

	const onSubmit = async (event: SubmitEvent) => {
		event.preventDefault();

		if (shownStep === 'done') {
			return;
		}

		const result = await flow.next();

		if (result.kind === 'refused') {
			shake();
		}

		if (result.kind === 'claimed') {
			haptic('firm-tap');
			onclaimed(result.handle);
		}

		await focusField();
	};

	// The field shows the cleaned value: characters the rule refuses never appear, and the
	// length is clamped after cleaning so a pasted "@name" or "123 456" still fits.
	const onHandleInput = (event: Event & { currentTarget: HTMLInputElement }) => {
		event.currentTarget.value = flow.inputHandle(event.currentTarget.value);
	};

	const onCodeInput = (event: Event & { currentTarget: HTMLInputElement }) => {
		event.currentTarget.value = flow.inputCode(event.currentTarget.value);
	};

	const onBack = () => {
		flow.back();
		void focusField();
	};

	const close = () => {
		const hadFocus = nonNullish(root) && root.contains(document.activeElement);

		landingClaimStore.close();

		if (!hadFocus) {
			return;
		}

		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}

		// On touch screens a refocused button would only light up; the keyboard user gets it back.
		if (window.matchMedia('(pointer: fine)').matches) {
			onreturnfocus();
		}
	};

	let wasOpen = false;

	$effect(() => {
		if (open === wasOpen) {
			return;
		}

		wasOpen = open;

		if (open) {
			untrack(() => flow.reopen());
			void focusField();
		}
	});

	$effect(() => {
		if (!open) {
			return;
		}

		const onPointerDown = (event: PointerEvent) => {
			if (event.target instanceof Node && root?.contains(event.target)) {
				return;
			}

			close();
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') {
				return;
			}

			event.stopPropagation();
			close();
		};

		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeyDown, true);

		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown, true);
		};
	});

	$effect(() => () => flow.dispose());
</script>

<!-- Keys typed here stay here: the page's own shortcuts (the deck's arrows and space) never see them. -->
<div
	bind:this={root}
	style:--lc-origin={`${originWidth}px`}
	class="lc"
	class:is-on={open}
	aria-hidden={!open}
	aria-label={t({ locale: $localeStore, key: 'landing.claim.dialog' })}
	inert={!open}
	onkeydown={(event) => event.stopPropagation()}
	role="dialog"
>
	<form bind:this={pill} class="lc-pill" novalidate onsubmit={(event) => void onSubmit(event)}>
		{#if shownStep === 'handle'}
			<span class="lc-at" aria-hidden="true">@</span>
			<input
				bind:this={handleInput}
				class="lc-input is-handle"
				aria-describedby={STATUS_ID}
				aria-label={t({ locale: $localeStore, key: 'landing.claim.handle_label' })}
				autocapitalize="none"
				autocomplete="off"
				enterkeyhint="next"
				oninput={onHandleInput}
				placeholder={t({ locale: $localeStore, key: 'landing.claim.handle_placeholder' })}
				spellcheck="false"
				type="text"
				value={flow.handle}
			/>
		{:else if shownStep === 'email'}
			<input
				bind:this={emailInput}
				class="lc-input is-pad"
				aria-describedby={STATUS_ID}
				aria-label={t({ locale: $localeStore, key: 'signin.email.aria' })}
				autocomplete="email"
				enterkeyhint="send"
				inputmode="email"
				oninput={(event) => flow.inputEmail(event.currentTarget.value)}
				placeholder={t({ locale: $localeStore, key: 'signin.email.placeholder' })}
				spellcheck="false"
				type="email"
				value={flow.email}
			/>
		{:else if shownStep === 'code'}
			<input
				bind:this={codeInput}
				class="lc-input is-pad is-code"
				aria-describedby={STATUS_ID}
				aria-label={t({ locale: $localeStore, key: 'signin.otp.aria' })}
				autocomplete="one-time-code"
				enterkeyhint="done"
				inputmode="numeric"
				oninput={onCodeInput}
				placeholder={t({
					locale: $localeStore,
					key: 'landing.claim.code_placeholder',
					params: { digits: LANDING_CLAIM_CODE_LENGTH }
				})}
				type="text"
				value={flow.code}
			/>
		{:else}
			<b class="lc-me"
				>{t({
					locale: $localeStore,
					key: 'landing.nav.handle',
					params: { handle: claimedHandle ?? '' }
				})}</b
			>
		{/if}
		{#if shownStep !== 'done'}
			<button class="lc-go" aria-busy={flow.busy} aria-disabled={flow.busy} type="submit">
				{t({ locale: $localeStore, key: ctaKey })}
			</button>
		{/if}
		<button
			bind:this={closeButton}
			class="lc-x"
			aria-label={t({ locale: $localeStore, key: 'a11y.close' })}
			onclick={close}
			type="button"
		>
			<span aria-hidden="true">×</span>
		</button>
	</form>
	<div class="lc-tray">
		<LandingClaimTray
			busy={flow.busy}
			{line}
			onback={onBack}
			statusId={STATUS_ID}
			step={shownStep}
		/>
	</div>
</div>

<style lang="postcss">
	.lc {
		--lc-out: cubic-bezier(0.23, 1, 0.32, 1);
		position: absolute;
		top: calc(11px + env(safe-area-inset-top, 0px));
		right: var(--ln-pad);
		width: min(440px, calc(100% - 2 * var(--ln-pad)));
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		justify-items: end;
		gap: 6px;
		visibility: hidden;
		pointer-events: none;
		transition: visibility 0s linear 260ms;
		color: var(--parchment);
		color-scheme: dark;
		touch-action: manipulation;
	}

	.lc.is-on {
		visibility: visible;
		pointer-events: auto;
		transition: visibility 0s;
	}

	/* Closed, the capsule is clipped to the button it grows from; opening widens the clip to full. */
	.lc-pill {
		width: 100%;
		height: 52px;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 5px;
		border-radius: 26px;
		background: color-mix(in srgb, var(--ink-raised) 80%, transparent);
		backdrop-filter: blur(34px) saturate(170%);
		-webkit-backdrop-filter: blur(34px) saturate(170%);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--parchment) 20%, transparent);
		clip-path: inset(0 0 0 calc(100% - var(--lc-origin, 170px)) round 26px);
		opacity: 0;
		transition:
			clip-path 240ms var(--lc-out),
			opacity 100ms linear 140ms,
			box-shadow 160ms var(--lc-out);
	}

	.lc.is-on .lc-pill {
		clip-path: inset(0 0 0 0 round 26px);
		opacity: 1;
		transition:
			clip-path 420ms cubic-bezier(0.32, 0.72, 0, 1),
			opacity 80ms linear,
			box-shadow 160ms var(--lc-out);
	}

	.lc-pill:focus-within {
		box-shadow: inset 0 0 0 1.5px var(--laurel);
	}

	.lc-at {
		flex: none;
		padding-left: 14px;
		font: 600 17px/1 var(--font-display);
		opacity: 0.55;
	}

	.lc-input {
		flex: 1 1 auto;
		min-width: 0;
		width: 0;
		height: 100%;
		padding: 0 8px 0 2px;
		border: 0;
		outline: 0;
		background: none;
		color: inherit;
		font: 500 16px/1.2 var(--font-display);
	}

	.lc-input.is-pad {
		padding-left: 16px;
	}

	.lc-input.is-code {
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.08em;
	}

	.lc-input::placeholder {
		color: color-mix(in srgb, var(--parchment) 45%, transparent);
		letter-spacing: normal;
	}

	.lc-me {
		flex: 1 1 auto;
		min-width: 0;
		padding-left: 16px;
		overflow: hidden;
		font: 700 17px/1 var(--font-display);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lc-go {
		flex: none;
		height: 42px;
		padding: 0 16px;
		border: 0;
		border-radius: 21px;
		background: var(--laurel);
		color: var(--ink);
		font: 600 15px/1 var(--font-display);
		cursor: pointer;
		transition:
			transform 140ms var(--lc-out),
			background 160ms var(--lc-out),
			opacity 160ms var(--lc-out);
	}

	.lc-go:active {
		transform: scale(0.97);
	}

	.lc-go[aria-busy='true'] {
		opacity: 0.7;
		cursor: progress;
	}

	.lc-x {
		flex: none;
		width: 42px;
		height: 42px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: none;
		color: inherit;
		font: 400 24px/1 var(--font-display);
		cursor: pointer;
		opacity: 0.75;
		transition:
			background 160ms var(--lc-out),
			opacity 160ms var(--lc-out);
	}

	.lc-go:focus-visible,
	.lc-x:focus-visible {
		outline: 2px solid var(--parchment);
		outline-offset: 2px;
	}

	@media (hover: hover) and (pointer: fine) {
		.lc-go:hover {
			background: color-mix(in srgb, var(--laurel) 86%, var(--parchment));
		}

		.lc-x:hover {
			background: color-mix(in srgb, var(--parchment) 10%, transparent);
			opacity: 1;
		}
	}

	.lc-tray {
		min-width: 0;
		max-width: 100%;
		opacity: 0;
		transform: translateY(-6px);
		transition:
			opacity 120ms var(--lc-out),
			transform 160ms var(--lc-out);
	}

	.lc.is-on .lc-tray {
		opacity: 1;
		transform: none;
		transition:
			opacity 200ms var(--lc-out) 160ms,
			transform 320ms var(--lc-out) 160ms;
	}

	@media (max-width: 380px) {
		.lc-go {
			padding: 0 12px;
		}

		.lc-x {
			width: 36px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lc-pill,
		.lc.is-on .lc-pill {
			clip-path: none;
			transition: opacity 120ms linear;
		}

		.lc-tray,
		.lc.is-on .lc-tray {
			transform: none;
			transition: opacity 120ms linear;
		}

		.lc-go {
			transition: none;
		}
	}

	@media (prefers-reduced-transparency: reduce) {
		.lc-pill {
			background: var(--ink-raised);
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
		}
	}
</style>
