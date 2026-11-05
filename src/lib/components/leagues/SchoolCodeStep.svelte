<script lang="ts">
	import { Mail } from '@lucide/svelte/icons';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';

	/**
	 * Pass-2 inbox step — the 6-digit code entry shown after a verification
	 * mail is sent (both the add-your-own and verify-existing flows land
	 * here). The owning {@link AffiliationPickerModal} keeps the state
	 * machine (and sanitizes the raw input); this component renders the
	 * body and reports edits via callbacks.
	 */
	interface Props {
		email: string;
		code: string;
		error: string | null;
		submitting: boolean;
		canSubmit: boolean;
		onCodeInput: (rawValue: string) => void;
		onSubmit: () => void;
	}

	const { email, code, error, submitting, canSubmit, onCodeInput, onSubmit }: Props = $props();

	// eslint-disable-next-line local-rules/prefer-object-params -- Locale-bound translate shorthand; key reads best positionally
	const tr = (key: MessageKey, params?: Record<string, string | number>) =>
		t({ locale: $localeStore, key, params });
</script>

<div class="affil-picker-verify">
	<span class="affil-picker-mail-icon" aria-hidden="true">
		<Mail size={22} strokeWidth={1.8} />
	</span>
	<h3 class="affil-picker-mail-title serif-italic">
		{tr('worlds.picker.school.code_sent_to', { email })}
	</h3>
	<p class="affil-picker-mail-body">{tr('worlds.picker.school.code_body')}</p>
	<input
		class="affil-picker-code num"
		aria-label={tr('worlds.picker.school.code_label')}
		disabled={submitting}
		inputmode="numeric"
		oninput={(event) => onCodeInput(event.currentTarget.value)}
		onkeydown={(event) => {
			if (event.key === 'Enter' && canSubmit) {
				event.preventDefault();
				onSubmit();
			}
		}}
		pattern="\d{'{'}6}"
		placeholder="000000"
		type="text"
		value={code}
	/>
	{#if error}
		<p class="affil-picker-error-inline affil-picker-error-center" role="alert">
			{error}
		</p>
	{/if}
</div>

<style lang="postcss">
	.affil-picker-verify {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.7rem;
		padding: 0.6rem 0 0.2rem;
		text-align: center;
	}

	.affil-picker-mail-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 56px;
		height: 56px;
		color: var(--laurel);
		background: color-mix(in srgb, var(--laurel) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--laurel) 30%, transparent);
		border-radius: var(--r-pill);
	}

	.affil-picker-mail-title {
		margin: 0;
		font-size: var(--t-20, 1.25rem);
		color: var(--text-base);
		overflow-wrap: anywhere;
	}

	.affil-picker-mail-body {
		margin: 0;
		max-width: 32ch;
		font-size: var(--t-13);
		line-height: 1.5;
		color: var(--text-muted);
	}

	.affil-picker-code {
		width: 100%;
		max-width: 240px;
		box-sizing: border-box;
		padding: 0.85rem;
		font-size: 1.75rem;
		font-weight: 600;
		letter-spacing: 0.3em;
		text-align: center;
		color: var(--text-base);
		background: color-mix(in srgb, var(--bg-surface) 70%, transparent);
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		outline: none;
	}

	.affil-picker-error-inline {
		margin: 0;
		font-size: var(--t-12);
		line-height: 1.5;
		color: var(--no);
	}

	.affil-picker-error-center {
		text-align: center;
	}
</style>
