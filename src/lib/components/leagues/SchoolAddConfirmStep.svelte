<script lang="ts">
	import type { WorldsAffiliationOption } from '#lib/constants/worlds-affiliations.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';

	/**
	 * Pass-2 "add your own school" confirm step — name entry with a
	 * fuzzy-dedupe panel so the user can pick an existing directory match
	 * before committing to a brand-new entry. The owning
	 * {@link AffiliationPickerModal} keeps the state machine; this
	 * component renders the body and reports edits via callbacks.
	 */
	interface Props {
		name: string;
		dupeMatches: readonly WorldsAffiliationOption[];
		onNameInput: (value: string) => void;
		onUseDupe: (option: WorldsAffiliationOption) => void;
	}

	const { name, dupeMatches, onNameInput, onUseDupe }: Props = $props();

	// eslint-disable-next-line local-rules/prefer-object-params -- Locale-bound translate shorthand; key reads best positionally
	const tr = (key: MessageKey, params?: Record<string, string | number>) =>
		t({ locale: $localeStore, key, params });

	const trimmedLength = $derived(name.trim().length);
</script>

<p class="affil-picker-hint serif-italic">
	{tr('worlds.picker.school.add_dedupe_hint')}
</p>

<label class="affil-picker-input-label num allcaps" for="sp-add-name">
	{tr('worlds.picker.school.name_label')}
</label>
<input
	id="sp-add-name"
	class="affil-picker-input"
	oninput={(event) => onNameInput(event.currentTarget.value)}
	placeholder={tr('worlds.picker.school.name_placeholder')}
	type="text"
	value={name}
/>

{#if dupeMatches.length > 0 && trimmedLength >= 2}
	<div class="affil-picker-dupe">
		<p class="affil-picker-dupe-title num allcaps">{tr('worlds.picker.school.dupe_title')}</p>
		{#each dupeMatches as dupe (dupe.id)}
			<button class="affil-picker-dupe-row" onclick={() => onUseDupe(dupe)} type="button">
				<span class="affil-picker-glyph affil-picker-glyph-sm" aria-hidden="true">
					{dupe.glyph}
				</span>
				<span class="affil-picker-dupe-body">
					<span class="affil-picker-dupe-name">{dupe.name}</span>
					<span class="affil-picker-dupe-meta num">
						{dupe.country ?? ''} · @{dupe.domains?.[0] ?? ''}
					</span>
				</span>
				<span class="affil-picker-dupe-use num allcaps">{tr('worlds.picker.school.use')}</span>
			</button>
		{/each}
	</div>
{:else if trimmedLength >= 3}
	<p class="affil-picker-ok">{tr('worlds.picker.school.not_in_directory')}</p>
{/if}

<style lang="postcss">
	.affil-picker-hint {
		margin: 0;
		font-size: var(--t-13);
		line-height: 1.45;
		color: var(--text-muted);
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

	.affil-picker-glyph-sm {
		width: 28px;
		height: 28px;
		font-size: 0.7rem;
	}

	.affil-picker-ok {
		margin: 0;
		padding: 0.6rem 0.75rem;
		font-size: var(--t-12);
		line-height: 1.5;
		color: var(--text-base);
		background: color-mix(in srgb, var(--yes, var(--laurel)) 6%, transparent);
		border: 1px solid color-mix(in srgb, var(--yes, var(--laurel)) 30%, transparent);
		border-radius: var(--r-12);
	}

	/* ── Dupe panel ── */
	.affil-picker-dupe {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.75rem 0.85rem;
		background: color-mix(in srgb, var(--laurel) 6%, transparent);
		border: 1px solid color-mix(in srgb, var(--laurel) 30%, transparent);
		border-radius: var(--r-12);
	}

	.affil-picker-dupe-title {
		font-size: var(--t-10);
		letter-spacing: 0.12em;
		color: var(--laurel);
	}

	.affil-picker-dupe-row {
		appearance: none;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.4rem 0;
		font: inherit;
		text-align: left;
		color: var(--text-base);
		background: none;
		border: none;
		border-top: 1px solid color-mix(in srgb, var(--laurel) 18%, transparent);
		cursor: pointer;
	}

	.affil-picker-dupe-body {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
	}

	.affil-picker-dupe-name {
		font-size: var(--t-13);
		font-weight: 600;
	}

	.affil-picker-dupe-meta {
		font-size: var(--t-10);
		color: var(--text-muted);
	}

	.affil-picker-dupe-use {
		font-size: var(--t-10);
		letter-spacing: 0.08em;
		color: var(--laurel);
	}
</style>
