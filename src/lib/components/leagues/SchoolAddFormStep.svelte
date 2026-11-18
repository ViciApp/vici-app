<script lang="ts">
	import type { WorldsAffiliationOption } from '#lib/constants/worlds-affiliations.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';

	/**
	 * Pass-2 "add your own school" email step: collects the school email
	 * for a brand-new entry, blocking consumer domains and redirecting to
	 * an existing directory school when the typed domain already belongs
	 * to one. The owning {@link AffiliationPickerModal} keeps the state
	 * machine; this component renders the body and reports edits via
	 * callbacks.
	 */
	interface Props {
		name: string;
		email: string;
		inferredCountry: string | null;
		consumerBlock: boolean;
		domainMatch: WorldsAffiliationOption | null;
		error: string | null;
		submitting: boolean;
		canSubmit: boolean;
		onEmailInput: (value: string) => void;
		onSubmit: () => void;
		onUseDomainMatch: (option: WorldsAffiliationOption) => void;
	}

	const {
		name,
		email,
		inferredCountry,
		consumerBlock,
		domainMatch,
		error,
		submitting,
		canSubmit,
		onEmailInput,
		onSubmit,
		onUseDomainMatch
	}: Props = $props();

	// eslint-disable-next-line local-rules/prefer-object-params -- Locale-bound translate shorthand; key reads best positionally
	const tr = (key: MessageKey, params?: Record<string, string | number>) =>
		t({ locale: $localeStore, key, params });
</script>

<div class="affil-picker-summary">
	<span class="affil-picker-summary-body">
		<span class="affil-picker-summary-eyebrow num allcaps">{tr('worlds.picker.school.adding')}</span
		>
		<span class="affil-picker-summary-name">{name}</span>
		{#if email && inferredCountry}
			<span class="affil-picker-summary-meta num">
				{inferredCountry} · {tr('worlds.picker.school.detected_from_email')}
			</span>
		{/if}
	</span>
</div>

<p class="affil-picker-explainer">
	{tr('worlds.picker.school.add_explainer')}
</p>

<label class="affil-picker-input-label num allcaps" for="sp-add-email">
	{tr('worlds.picker.school.email_label')}
</label>
<input
	id="sp-add-email"
	class="affil-picker-input num"
	class:is-bad={consumerBlock}
	autocapitalize="off"
	autocorrect="off"
	disabled={submitting}
	oninput={(event) => onEmailInput(event.currentTarget.value)}
	onkeydown={(event) => {
		if (event.key === 'Enter' && canSubmit) {
			event.preventDefault();
			onSubmit();
		}
	}}
	placeholder={tr('worlds.picker.school.email_placeholder', { domain: 'school.edu' })}
	spellcheck="false"
	type="email"
	value={email}
/>
{#if consumerBlock}
	<p class="affil-picker-error-inline">{tr('worlds.picker.school.consumer_blocked')}</p>
{/if}
{#if domainMatch}
	<div class="affil-picker-redirect">
		<span>{tr('worlds.picker.school.domain_belongs', { name: domainMatch.name })}</span>
		<button
			class="affil-picker-redirect-cta"
			onclick={() => onUseDomainMatch(domainMatch)}
			type="button"
		>
			{tr('worlds.picker.school.use_existing', {
				name: domainMatch.short ?? domainMatch.name
			})}
		</button>
	</div>
{/if}
{#if error}
	<p class="affil-picker-error-inline" role="alert">{error}</p>
{/if}

<style lang="postcss">
	.affil-picker-summary {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0.85rem;
		background: color-mix(in srgb, var(--bg-surface) 70%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
	}

	.affil-picker-summary-body {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.2rem;
	}

	.affil-picker-summary-eyebrow {
		font-size: var(--t-10);
		letter-spacing: 0.12em;
		color: var(--text-muted);
	}

	.affil-picker-summary-name {
		font-size: var(--t-15, 0.95rem);
		font-weight: 600;
		color: var(--text-base);
	}

	.affil-picker-summary-meta {
		font-size: var(--t-10);
		color: var(--text-muted);
	}

	.affil-picker-explainer {
		margin: 0;
		padding: 0.7rem 0.85rem;
		font-size: var(--t-12);
		line-height: 1.55;
		color: var(--text-muted);
		background: color-mix(in srgb, var(--text-base) 3%, transparent);
		border-left: 2px solid var(--laurel);
	}

	.affil-picker-input-label {
		font-size: var(--t-10);
		letter-spacing: 0.1em;
		color: var(--text-muted);
	}

	.affil-picker-input {
		appearance: none;
		width: 100%;
		box-sizing: border-box;
		padding: 0.75rem 0.85rem;
		font: inherit;
		font-size: var(--t-14);
		color: var(--text-base);
		background: color-mix(in srgb, var(--bg-surface) 70%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		outline: none;
	}

	.affil-picker-input.is-bad {
		border-color: var(--no);
	}

	.affil-picker-error-inline {
		margin: 0;
		font-size: var(--t-12);
		line-height: 1.5;
		color: var(--no);
	}

	/* ── Domain redirect ── */
	.affil-picker-redirect {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.7rem 0.85rem;
		font-size: var(--t-12);
		line-height: 1.5;
		color: var(--text-base);
		background: color-mix(in srgb, var(--laurel) 6%, transparent);
		border: 1px solid color-mix(in srgb, var(--laurel) 30%, transparent);
		border-radius: var(--r-12);
	}

	.affil-picker-redirect-cta {
		appearance: none;
		align-self: flex-start;
		padding: 0.4rem 0.85rem;
		font: inherit;
		font-size: var(--t-12);
		font-weight: 600;
		color: var(--ink, #0e0d0b);
		background: var(--laurel);
		border: none;
		border-radius: var(--r-pill);
		cursor: pointer;
	}
</style>
