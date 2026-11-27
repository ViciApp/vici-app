<script lang="ts">
	import { LANDING_CLAIM_PRIVACY_PATH } from '#lib/constants/landing-claim.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LandingClaimStep } from '#lib/types/landing-claim.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import type { LandingClaimLine } from '#lib/utils/landing-claim.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';

	interface Props {
		line: LandingClaimLine;
		step: LandingClaimStep;
		statusId: string;
		busy?: boolean;
		onback?: () => void;
	}

	const { line, step, statusId, busy = false, onback = () => {} }: Props = $props();

	const text = $derived(
		'text' in line ? line.text : t({ locale: $localeStore, key: line.key, params: line.params })
	);
</script>

<!-- The status line is the live region; the links below it are not re-announced on every keystroke. -->
<div class="lct">
	<p
		id={statusId}
		class="lct-line"
		class:is-no={line.tone === 'no'}
		class:is-yes={line.tone === 'yes'}
		aria-live="polite"
	>
		{text}
	</p>
	{#if step === 'email'}
		<p class="lct-fine">
			{t({ locale: $localeStore, key: 'landing.claim.consent' })}
			<a
				class="lct-link"
				href={resolveAppPath(LANDING_CLAIM_PRIVACY_PATH)}
				rel="noopener noreferrer"
				target="_blank"
			>
				{t({ locale: $localeStore, key: 'landing.claim.privacy' })}
			</a>
		</p>
	{:else if step === 'code'}
		<button class="lct-link lct-back" disabled={busy} onclick={onback} type="button">
			{t({ locale: $localeStore, key: 'signin.otp.back' })}
		</button>
	{/if}
</div>

<style lang="postcss">
	.lct {
		min-width: 0;
		max-width: 100%;
		margin: 0;
		padding: 8px 12px;
		border-radius: 16px;
		background: color-mix(in srgb, var(--ink-raised) 80%, transparent);
		backdrop-filter: blur(34px) saturate(170%);
		-webkit-backdrop-filter: blur(34px) saturate(170%);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--parchment) 14%, transparent);
		color: color-mix(in srgb, var(--parchment) 80%, transparent);
		font: 500 13px/1.35 var(--font-display);
		text-wrap: pretty;
	}

	.lct-line {
		margin: 0;
	}

	.lct-line.is-yes {
		color: var(--yes);
	}

	.lct-line.is-no {
		color: var(--no);
	}

	.lct-fine {
		margin: 4px 0 0;
		color: color-mix(in srgb, var(--parchment) 60%, transparent);
	}

	.lct-link {
		position: relative;
		padding: 0;
		border: 0;
		background: none;
		color: var(--parchment);
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 3px;
		white-space: nowrap;
		cursor: pointer;
	}

	/* A taller hit area than the 13px line, without moving the text. */
	.lct-link::after {
		content: '';
		position: absolute;
		inset: -8px -4px;
	}

	.lct-back {
		display: block;
		margin-top: 4px;
	}

	.lct-back:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.lct-link:focus-visible {
		outline: 2px solid var(--parchment);
		outline-offset: 2px;
		border-radius: 2px;
	}

	@media (hover: hover) and (pointer: fine) {
		.lct-link:hover {
			color: var(--laurel);
		}
	}

	@media (prefers-reduced-transparency: reduce) {
		.lct {
			background: var(--ink-raised);
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
		}
	}
</style>
