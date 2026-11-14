<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import Modal from '#lib/components/ui/Modal.svelte';
	import { LeaguePrivacy } from '#lib/enums/league.ts';
	import { updateLeague } from '#lib/services/leagues.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		isOpen: boolean;
		onClose: () => void;
		/** Fires after a successful privacy change so the parent re-fetches. */
		onSaved: () => void;
		leagueId: string;
		/** The league's current effective privacy (resolved via `leaguePrivacy`). */
		currentPrivacy: LeaguePrivacy;
	}

	const { isOpen, onClose, onSaved, leagueId, currentPrivacy }: Props = $props();

	// Same order the create sheet uses, Open / Private, so the picker
	// reads identically across both surfaces.
	const OPTIONS = [LeaguePrivacy.OPEN, LeaguePrivacy.PRIVATE] as const;

	// Seeded from `currentPrivacy` every time the sheet opens (see the
	// `$effect` below), so the initial value here is just a placeholder
	// until then: referencing the prop at init would freeze it.
	let selected = $state<LeaguePrivacy>(LeaguePrivacy.OPEN);
	// Second step shown only for the loosen-to-Open direction: switching a
	// non-public league to Open exposes its existing members in public
	// lists + friend recommendations, which can't be undone for anyone who
	// has already seen it: so we gate it behind an explicit confirmation.
	let confirming = $state(false);
	let submitting = $state(false);
	let submitError: string | null = $state(null);

	// Re-seed the selection from the current value every time the sheet
	// opens, so reopening after a change (or a cancel) starts from truth.
	$effect(() => {
		if (isOpen) {
			selected = currentPrivacy;
			confirming = false;
			submitError = null;
		}
	});

	const optionLabel = (value: LeaguePrivacy): string =>
		t({ locale: $localeStore, key: `leagues.create.privacy_${value}` });

	const optionDesc = (value: LeaguePrivacy): string =>
		t({ locale: $localeStore, key: `leagues.privacy.desc_${value}` });

	const isLooseningToOpen = $derived(
		selected === LeaguePrivacy.OPEN && currentPrivacy !== LeaguePrivacy.OPEN
	);

	const canSubmit = $derived(!submitting && selected !== currentPrivacy);

	const reset = () => {
		selected = currentPrivacy;
		confirming = false;
		submitting = false;
		submitError = null;
	};

	const handleClose = () => {
		reset();
		onClose();
	};

	const persist = async () => {
		submitting = true;
		submitError = null;

		try {
			await updateLeague({ id: leagueId, privacy: selected });
			onSaved();
			reset();
		} catch (err) {
			console.error('LeaguePrivacyModal: updateLeague failed', err);
			submitError = t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			submitting = false;
		}
	};

	const handleSubmit = async (event: Event) => {
		event.preventDefault();

		if (!canSubmit) {
			return;
		}

		// Loosening to Open needs the explicit confirm step first.
		if (isLooseningToOpen && !confirming) {
			confirming = true;

			return;
		}

		await persist();
	};
</script>

<Modal {isOpen} onClose={handleClose}>
	<form class="league-form" onsubmit={handleSubmit}>
		{#if confirming}
			<header class="league-form-head">
				<h2>{t({ locale: $localeStore, key: 'leagues.privacy.confirm_open_title' })}</h2>
				<p>{t({ locale: $localeStore, key: 'leagues.privacy.confirm_open_body' })}</p>
			</header>

			{#if nonNullish(submitError)}
				<p class="league-privacy-error">{submitError}</p>
			{/if}

			<div class="league-form-actions">
				<button
					class="league-form-cancel"
					disabled={submitting}
					onclick={() => (confirming = false)}
					type="button"
				>
					{t({ locale: $localeStore, key: 'leagues.privacy.cancel' })}
				</button>
				<button class="league-form-submit is-danger" disabled={!canSubmit} type="submit">
					{t({
						locale: $localeStore,
						key: submitting ? 'leagues.privacy.saving' : 'leagues.privacy.confirm_open_confirm'
					})}
				</button>
			</div>
		{:else}
			<header class="league-form-head">
				<h2 id="league-privacy-title">
					{t({ locale: $localeStore, key: 'leagues.privacy.title' })}
				</h2>
				<p>{t({ locale: $localeStore, key: 'leagues.privacy.sub' })}</p>
			</header>

			<ul class="league-privacy-list" aria-labelledby="league-privacy-title" role="radiogroup">
				{#each OPTIONS as option (option)}
					<li>
						<button
							class="league-vis-card"
							class:is-active={selected === option}
							aria-checked={selected === option}
							onclick={() => (selected = option)}
							role="radio"
							type="button"
						>
							<span class="league-vis-radio" aria-hidden="true"></span>
							<span class="league-vis-body">
								<span class="league-vis-title">{optionLabel(option)}</span>
								<span class="league-vis-sub">{optionDesc(option)}</span>
							</span>
						</button>
					</li>
				{/each}
			</ul>

			{#if nonNullish(submitError)}
				<p class="league-privacy-error">{submitError}</p>
			{/if}

			<div class="league-form-actions">
				<button class="league-form-cancel" onclick={handleClose} type="button">
					{t({ locale: $localeStore, key: 'leagues.privacy.cancel' })}
				</button>
				<button class="league-form-submit" disabled={!canSubmit} type="submit">
					{t({
						locale: $localeStore,
						key: submitting ? 'leagues.privacy.saving' : 'leagues.privacy.save'
					})}
				</button>
			</div>
		{/if}
	</form>
</Modal>

<style lang="postcss">
	.league-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
	}

	.league-form-head h2 {
		margin: 0 0 0.25rem;
		font-size: var(--t-18);
		font-weight: 600;
		color: var(--text-base);
	}

	.league-form-head p {
		margin: 0;
		font-size: var(--t-13);
		line-height: 1.5;
		color: var(--text-muted);
	}

	.league-privacy-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.league-vis-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.7rem 0.8rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-12);
		background: var(--bg-surface);
		color: var(--text-base);
		text-align: left;
		cursor: pointer;
		transition:
			border-color var(--d-hover) var(--ease-vici),
			background-color var(--d-hover) var(--ease-vici);
	}

	.league-vis-card.is-active {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 6%, var(--bg-surface));
	}

	.league-vis-radio {
		flex: 0 0 auto;
		width: 18px;
		height: 18px;
		border-radius: var(--r-pill);
		border: 2px solid var(--border-base);
		transition: border-color var(--d-hover) var(--ease-vici);
	}

	.league-vis-card.is-active .league-vis-radio {
		border-color: var(--color-accent);
		box-shadow:
			inset 0 0 0 3px var(--bg-surface),
			inset 0 0 0 9px var(--color-accent);
	}

	.league-vis-body {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}

	.league-vis-title {
		font-size: var(--t-14);
		font-weight: 600;
	}

	.league-vis-card.is-active .league-vis-title {
		color: var(--color-accent);
	}

	.league-vis-sub {
		font-size: var(--t-12);
		line-height: 1.45;
		color: var(--text-muted);
	}

	.league-privacy-error {
		margin: 0;
		padding: 0.55rem 0.7rem;
		font-size: var(--t-12);
		color: var(--danger);
		background: color-mix(in srgb, var(--danger) 8%, transparent);
		border-radius: var(--r-8);
	}

	.league-form-actions {
		display: flex;
		gap: 0.5rem;
	}

	.league-form-cancel,
	.league-form-submit {
		flex: 1;
		padding: 0.7rem 1rem;
		border-radius: var(--r-8);
		font-size: var(--t-13);
		font-weight: 600;
		cursor: pointer;
	}

	.league-form-cancel {
		border: 1px solid var(--border-base);
		background: transparent;
		color: var(--text-base);
	}

	.league-form-submit {
		border: 0;
		background: var(--color-primary);
		color: var(--color-primary-foreground);
	}

	.league-form-submit.is-danger {
		background: var(--danger);
		color: #fff;
	}

	.league-form-submit:disabled,
	.league-form-cancel:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
