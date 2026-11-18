<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import { transferLeagueOwnership } from '#lib/services/leagues.services.ts';
	import { loadProfilesByPrincipals } from '#lib/services/profile.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { profilesStore } from '#lib/stores/profiles.store.ts';
	import type { LeagueMemberDoc } from '#lib/types/league-member.ts';
	import { shortenPrincipal } from '#lib/utils/format.utils.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';

	interface Props {
		isOpen: boolean;
		onClose: () => void;
		onTransferred: () => void;
		leagueId: string;
		/**
		 * The full roster. The modal filters out the caller (current
		 * owner) and any rows still labelled `'owner'` defensively, so
		 * the picker only shows promotable members.
		 */
		members: LeagueMemberDoc[];
		/** Current owner's principal: excluded from the picker. */
		currentOwnerPrincipal: string;
	}

	const { isOpen, onClose, onTransferred, leagueId, members, currentOwnerPrincipal }: Props =
		$props();

	let selected = $state<string | null>(null);
	let submitting = $state(false);
	let submitError: MessageKey | string | null = $state(null);

	// Filter out the current owner + any defensive duplicate-owner rows.
	// Sort by joined-ascending so longest-tenured members sit first:
	// the most common transfer target.
	const candidates = $derived(
		[...members]
			.filter((m) => m.member !== currentOwnerPrincipal && m.role !== 'owner')
			.sort((a, b) => a.joinedAtMs - b.joinedAtMs)
	);

	const canSubmit = $derived(!submitting && nonNullish(selected));

	const reset = () => {
		selected = null;
		submitting = false;
		submitError = null;
	};

	const handleClose = () => {
		reset();
		onClose();
	};

	const handleSubmit = async (event: Event) => {
		event.preventDefault();

		if (!canSubmit || isNullish(selected)) {
			return;
		}

		submitting = true;
		submitError = null;

		try {
			const result = await transferLeagueOwnership({
				leagueId,
				newOwnerPrincipal: selected
			});

			if (!result.ok) {
				submitError = reasonToMessageKey(result.reason);

				return;
			}

			onTransferred();
			reset();
		} catch (err) {
			console.error('TransferOwnershipModal: transferLeagueOwnership failed', err);
			submitError = t({ locale: $localeStore, key: 'common.error.generic' });
		} finally {
			submitting = false;
		}
	};

	const reasonToMessageKey = (reason?: string): MessageKey => {
		switch (reason) {
			case 'not_owner':
				return 'leagues.transfer.error_not_owner';
			case 'league_not_found':
				return 'leagues.transfer.error_league_not_found';
			case 'new_owner_not_member':
				return 'leagues.transfer.error_new_owner_not_member';
			case 'new_owner_is_caller':
				return 'leagues.transfer.error_new_owner_is_caller';
			default:
				return 'leagues.transfer.error_generic';
		}
	};

	const memberHandle = (principal: string): string => {
		const profile = $profilesStore.get(principal);

		if (profile?.nickname && profile.nickname.length > 0) {
			return `@${profile.nickname}`;
		}

		return shortenPrincipal(principal);
	};

	onMount(() => {
		// Hydrate nicknames for the candidate list; the league-detail
		// page may not have loaded them yet if the user opens this modal
		// before scrolling the roster.
		void loadProfilesByPrincipals({ principals: candidates.map((c) => c.member) });
	});
</script>

<Modal {isOpen} onClose={handleClose}>
	<form class="league-form" onsubmit={handleSubmit}>
		<header class="league-form-head">
			<h2>{t({ locale: $localeStore, key: 'leagues.transfer.title' })}</h2>
			<p>{t({ locale: $localeStore, key: 'leagues.transfer.sub' })}</p>
		</header>

		{#if candidates.length === 0}
			<p class="league-transfer-empty">
				{t({ locale: $localeStore, key: 'leagues.transfer.empty' })}
			</p>
		{:else}
			<ul class="league-transfer-list" role="radiogroup">
				{#each candidates as candidate (candidate.member)}
					<li>
						<button
							class="league-transfer-row"
							class:is-active={selected === candidate.member}
							aria-checked={selected === candidate.member}
							onclick={() => (selected = candidate.member)}
							role="radio"
							type="button"
						>
							<span class="league-transfer-row-handle">{memberHandle(candidate.member)}</span>
							<span class="league-transfer-row-role allcaps">
								{t({
									locale: $localeStore,
									key: candidate.role === 'admin' ? 'leagues.role.admin' : 'leagues.role.member'
								})}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if nonNullish(submitError)}
			<p class="league-transfer-error">
				{typeof submitError === 'string' && submitError.startsWith('leagues.')
					? t({ locale: $localeStore, key: submitError as MessageKey })
					: submitError}
			</p>
		{/if}

		<div class="league-form-actions">
			<button class="league-form-cancel" onclick={handleClose} type="button">
				{t({ locale: $localeStore, key: 'settings.cancel' })}
			</button>
			<button
				class="league-form-submit"
				disabled={!canSubmit || candidates.length === 0}
				type="submit"
			>
				{t({
					locale: $localeStore,
					key: submitting ? 'leagues.transfer.submitting' : 'leagues.transfer.submit'
				})}
			</button>
		</div>
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

	.league-transfer-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		list-style: none;
		padding: 0;
		margin: 0;
		max-height: 20rem;
		overflow-y: auto;
	}

	.league-transfer-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		width: 100%;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-8);
		background: var(--bg-surface);
		color: var(--text-base);
		font-size: var(--t-13);
		text-align: left;
		cursor: pointer;
		transition:
			border-color var(--d-hover) var(--ease-vici),
			background-color var(--d-hover) var(--ease-vici);
	}

	.league-transfer-row.is-active {
		border-color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 8%, var(--bg-surface));
	}

	.league-transfer-row-handle {
		font-weight: 600;
	}

	.league-transfer-row-role {
		font-size: var(--t-10);
		color: var(--text-muted);
		letter-spacing: var(--tracking-allcaps);
	}

	.league-transfer-empty {
		margin: 0;
		padding: 1rem;
		font-size: var(--t-13);
		color: var(--text-muted);
		text-align: center;
		background: var(--bg-popover);
		border: 1px dashed var(--border-base);
		border-radius: var(--r-8);
	}

	.league-transfer-error {
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

	.league-form-submit:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
