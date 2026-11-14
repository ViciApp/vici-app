<script lang="ts">
	import type { WorldsAffiliationOption } from '#lib/constants/worlds-affiliations.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';

	/**
	 * Pass-2 "verify your school" step: the email-entry screen for a
	 * directory university that carries an email domain. The owning
	 * {@link AffiliationPickerModal} keeps the add/verify state machine;
	 * this component renders the body and reports edits via callbacks.
	 */
	interface Props {
		target: WorldsAffiliationOption;
		email: string;
		wrongDomain: boolean;
		error: string | null;
		submitting: boolean;
		canSend: boolean;
		onEmailInput: (value: string) => void;
		onSubmit: () => void;
	}

	const { target, email, wrongDomain, error, submitting, canSend, onEmailInput, onSubmit }: Props =
		$props();

	// eslint-disable-next-line local-rules/prefer-object-params -- Locale-bound translate shorthand; key reads best positionally
	const tr = (key: MessageKey, params?: Record<string, string | number>) =>
		t({ locale: $localeStore, key, params });
</script>

<div class="affil-picker-summary">
	<span class="affil-picker-glyph" aria-hidden="true">{target.glyph}</span>
	<span class="affil-picker-summary-body">
		<span class="affil-picker-summary-eyebrow num allcaps"
			>{tr('worlds.picker.school.verify_eyebrow')}</span
		>
		<span class="affil-picker-summary-name">{target.name}</span>
	</span>
</div>

<p class="affil-picker-explainer">
	{tr('worlds.picker.school.verify_explainer', {
		name: target.short ?? target.name
	})}
</p>

<label class="affil-picker-input-label num allcaps" for="sp-verify-email">
	{tr('worlds.picker.school.email_label')}
</label>
<input
	id="sp-verify-email"
	class="affil-picker-input num"
	class:is-bad={wrongDomain}
	autocapitalize="off"
	autocorrect="off"
	disabled={submitting}
	oninput={(event) => onEmailInput(event.currentTarget.value)}
	onkeydown={(event) => {
		if (event.key === 'Enter' && canSend) {
			event.preventDefault();
			onSubmit();
		}
	}}
	placeholder={tr('worlds.picker.school.email_placeholder', {
		domain: target.domains?.[0] ?? 'school.edu'
	})}
	spellcheck="false"
	type="email"
	value={email}
/>
{#if wrongDomain}
	<p class="affil-picker-error-inline">
		{tr('worlds.picker.school.wrong_domain', {
			name: target.short ?? target.name,
			domain: target.domains?.[0] ?? ''
		})}
	</p>
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

	.affil-picker-glyph {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		border-radius: var(--r-8);
		background: var(--bg-surface);
		font-family: var(--font-mono);
		font-size: 0.85rem;
		font-weight: 700;
		overflow: hidden;
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
</style>
