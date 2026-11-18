<script lang="ts">
	import { Plus, Share2 } from '@lucide/svelte/icons';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		/** Open the add-friend search sheet. */
		onAdd: () => void;
		/** Fire the native share / copy invite flow. */
		onInvite: () => void;
		/** Whether the invite CTA is actionable (a share URL exists and the
		 *  referral cap isn't reached). */
		canInvite?: boolean;
	}

	const { onAdd, onInvite, canInvite = true }: Props = $props();
</script>

<section class="friends-empty">
	<p class="friends-empty-quote">
		{t({ locale: $localeStore, key: 'arena.friends.empty.quote' })}
	</p>
	<p class="friends-empty-sub">
		{t({ locale: $localeStore, key: 'arena.friends.empty.sub' })}
	</p>
	<div class="friends-empty-actions">
		<button class="friends-empty-primary" onclick={onAdd} type="button">
			<Plus aria-hidden="true" size={14} strokeWidth={2} />
			{t({ locale: $localeStore, key: 'arena.friends.empty.add_first' })}
		</button>
		<button class="friends-empty-ghost" disabled={!canInvite} onclick={onInvite} type="button">
			<Share2 aria-hidden="true" size={14} strokeWidth={1.8} />
			{t({ locale: $localeStore, key: 'arena.friends.empty.invite_now' })}
		</button>
	</div>
</section>

<style lang="postcss">
	.friends-empty {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		align-items: center;
		padding: 1.25rem 1rem;
		border: 1px dashed var(--border-base);
		border-radius: var(--r-16, 1rem);
		background: var(--bg-surface);
		text-align: center;
	}

	.friends-empty-quote {
		margin: 0;
		color: var(--color-primary);
		font-family: var(--font-serif, var(--font-display, serif));
		font-style: italic;
		font-size: var(--t-16);
	}

	.friends-empty-sub {
		margin: 0 0 0.5rem;
		color: var(--text-muted);
		font-size: var(--t-13);
		line-height: var(--leading-snug);
	}

	.friends-empty-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.625rem;
	}

	.friends-empty-primary,
	.friends-empty-ghost {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 44px;
		padding: 0.6875rem 1rem;
		border-radius: var(--r-pill);
		font: inherit;
		font-size: var(--t-13);
		font-weight: 700;
		cursor: pointer;
	}

	.friends-empty-primary {
		border: 0;
		background: var(--brand);
		color: var(--color-primary-foreground);
	}

	.friends-empty-ghost {
		border: 1px solid var(--border-base);
		background: transparent;
		color: var(--text-base);
	}

	.friends-empty-ghost:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
