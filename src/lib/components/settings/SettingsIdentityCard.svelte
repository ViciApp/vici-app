<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import Avatar from '#lib/components/profile/Avatar.svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import {
		decisiveSettledCount,
		resolvedPositionsNotInitialized
	} from '#lib/derived/resolved-positions.derived.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { UserProfile } from '#lib/types/profile.ts';
	import { displayAccuracyPct } from '#lib/utils/accuracy.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';

	interface Props {
		profile: UserProfile | undefined;
		joinedLabel: string | null;
	}

	let { profile, joinedLabel }: Props = $props();

	// Settings always shows the signed-in user's own identity, so a user with
	// no settled predictions yet shows an optimistic 100% rather than a
	// misleading 0% (display-only — see `displayAccuracyPct`).
	const accuracyDisplay = $derived(
		displayAccuracyPct({
			accuracy: profile?.accuracy ?? 0,
			settledCount: $decisiveSettledCount,
			initialized: !$resolvedPositionsNotInitialized
		})
	);
</script>

<button class="set-identity" onclick={() => goto(resolveAppPath(AppPath.Profile))} type="button">
	{#if profile}
		<span class="set-identity-avatar">
			<Avatar
				class="h-full w-full"
				avatar={profile.avatar}
				nickname={profile.nickname}
				owner={profile.owner}
				self
			/>
		</span>
	{:else}
		<span class="set-identity-avatar set-identity-avatar-fallback" aria-hidden="true"> V </span>
	{/if}
	<span class="set-identity-copy">
		<span class="set-identity-handle">
			@{profile?.nickname?.trim() ?? t({ locale: $localeStore, key: 'settings.identity.fallback' })}
		</span>
		<span class="set-identity-meta num">
			{t({
				locale: $localeStore,
				key: 'settings.identity.meta',
				params: {
					level: profile?.level ?? 1,
					accuracy: accuracyDisplay,
					calls: profile?.totalTrades ?? 0
				}
			})}
		</span>
		{#if nonNullish(joinedLabel)}
			<span class="set-identity-joined">
				{t({
					locale: $localeStore,
					key: 'settings.identity.joined',
					params: { date: joinedLabel }
				})}
			</span>
		{/if}
	</span>
</button>

<style lang="postcss">
	.set-identity {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.875rem;
		border: none;
		background: var(--bg-surface);
		color: var(--text-base);
		text-align: left;
		cursor: pointer;
	}

	.set-identity-avatar {
		display: flex;
		overflow: hidden;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		flex-shrink: 0;
		border-radius: var(--r-pill);
		background: var(--bg-popover);
	}

	.set-identity-avatar-fallback {
		background: var(--laurel-glow);
		color: var(--color-primary);
		font-weight: 700;
	}

	.set-identity-copy {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.set-identity-handle {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		font-size: var(--t-14);
		font-weight: 600;
		color: var(--text-base);
	}

	.set-identity-meta {
		font-size: var(--t-11);
		color: var(--text-muted);
	}

	.set-identity-joined {
		font-size: var(--t-11);
		color: var(--text-muted);
		opacity: 0.7;
	}
</style>
