<script lang="ts">
	import BaseButton from '#lib/components/ui/BaseButton.svelte';
	import BottomSheet from '#lib/components/ui/BottomSheet.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	/**
	 * Add-by-handle bottom sheet — an `@`-prefixed input opened from the
	 * ranked-list "Add" chip in {@link FriendsTab}. Submitting writes
	 * through to the friend-request service the host owns; the visual
	 * handle prefix is the user-facing affordance until the satellite
	 * gains nickname-based lookup.
	 *
	 * Chrome (scrim, grip, safe-area inset, Escape, focus-trap, pill-nav
	 * hide) comes from the shared {@link BottomSheet} primitive; this
	 * component owns only the sheet body. The input text is `$bindable`
	 * so the host keeps the canonical value it submits / resets.
	 */
	interface Props {
		isOpen: boolean;
		value: string;
		adding: boolean;
		inviteHintAmount: string;
		onSubmit: () => void;
		onClose: () => void;
	}

	let {
		isOpen,
		value = $bindable(),
		adding,
		inviteHintAmount,
		onSubmit,
		onClose
	}: Props = $props();
</script>

<BottomSheet {isOpen} {onClose}>
	<h3 class="friends-sheet-title">
		{t({ locale: $localeStore, key: 'arena.friends.add.sheet_title' })}
	</h3>
	<p class="friends-sheet-blurb">
		{t({ locale: $localeStore, key: 'arena.friends.add.sheet_blurb' })}
	</p>
	<div class="friends-add-input">
		<span class="friends-add-prefix" aria-hidden="true">@</span>
		<input
			class="friends-add-field num"
			aria-label={t({ locale: $localeStore, key: 'arena.friends.add.cta' })}
			autocapitalize="none"
			autocomplete="off"
			autocorrect="off"
			onkeydown={(event) => {
				// Mirror the CTA's disabled/pending guard so the keyboard path
				// can't fire a duplicate (or empty) submission.
				if (event.key === 'Enter' && !adding && value.trim().length > 0) {
					onSubmit();
				}
			}}
			placeholder={t({ locale: $localeStore, key: 'arena.friends.add.placeholder' })}
			spellcheck="false"
			type="text"
			bind:value
		/>
	</div>
	<p class="friends-add-footnote num">
		{t({
			locale: $localeStore,
			key: 'arena.friends.add.invite_hint',
			params: { amount: inviteHintAmount }
		})}
	</p>
	<BaseButton
		class="friends-sheet-remove friends-sheet-primary"
		onclick={onSubmit}
		status={adding ? 'pending' : value.trim().length === 0 ? 'disabled' : 'enabled'}
	>
		{adding
			? t({ locale: $localeStore, key: 'arena.friends.add.sending' })
			: t({ locale: $localeStore, key: 'arena.friends.add.cta' })}
	</BaseButton>
	<BaseButton class="friends-sheet-close" onclick={onClose}>
		{t({ locale: $localeStore, key: 'arena.friends.sheet.close' })}
	</BaseButton>
</BottomSheet>

<style lang="postcss">
	.friends-sheet-title {
		margin: 0.25rem 0 0.35rem;
		color: var(--text-base);
		font-size: var(--t-18);
		font-weight: 600;
	}

	.friends-sheet-blurb {
		margin: 0 0 0.75rem;
		color: var(--text-muted);
		font-size: var(--t-13);
		line-height: var(--leading-snug);
	}

	.friends-add-input {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.65rem 0.85rem;
		border: 1px solid var(--border-base);
		border-radius: var(--r-pill);
		background: var(--bg-surface);
	}

	.friends-add-prefix {
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-14);
		font-weight: 800;
	}

	.friends-add-field {
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;
		color: var(--text-base);
		font-size: var(--t-13);
		outline: none;
	}

	.friends-add-footnote {
		margin: 0.55rem 0 0.85rem;
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: var(--t-10);
		font-weight: 800;
		letter-spacing: var(--tracking-allcaps);
		text-transform: uppercase;
	}
	/* Shared `.friends-sheet-remove` / `-primary` / `-close` button styles
	   live in app.css (used by both friends sheets). */
</style>
