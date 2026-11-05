<script lang="ts">
	import YouBadge from '#lib/components/ui/YouBadge.svelte';
	import { globalActivities } from '#lib/derived/activities.derived.ts';
	import { authPrincipal } from '#lib/derived/user.derived.ts';
	import { ActivityType } from '#lib/enums/social.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { profilesStore } from '#lib/stores/profiles.store.ts';
	import { shortenWithMiddleEllipsis } from '#lib/utils/format.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		marketId: string;
		isEmbedded?: boolean;
	}

	const { marketId, isEmbedded = false }: Props = $props();

	// Both this component and `ActivityFeed` drink from the same cached
	// global feed (populated by `LoaderGlobalActivities`). Profiles for
	// the authors are hydrated by the loader's side-effect, so we just
	// read them from `profilesStore` without an extra fetch loop.
	const activities = $derived($globalActivities.filter((a) => a.marketId === marketId));

	const displayNameFor = (principal: string): string => {
		const nickname = $profilesStore.get(principal)?.nickname;

		return nickname && nickname.length > 0
			? nickname
			: shortenWithMiddleEllipsis({ text: principal });
	};

	// First character of the display name, in caps. Brand: no emoji
	// avatar fallback — initials in a tinted disc instead. See
	// `docs/ai/frontend/brand.md §2.3`. `charAt(0)` is UTF-16-unit
	// based, which is fine here: nicknames the satellite accepts are
	// ASCII/Latin, and the principal shortener fallback is hex.
	const initialFor = (principal: string): string => {
		const name = displayNameFor(principal).trim();
		const first = name.charAt(0);

		return first ? first.toUpperCase() : '·';
	};
</script>

<div
	class={isEmbedded ? 'space-y-4 pt-4' : 'border-border bg-card space-y-4 rounded-3xl border p-6'}
>
	{#if !isEmbedded}
		<h3 class="text-muted-foreground text-xs font-black tracking-widest uppercase">
			{t({ locale: $localeStore, key: 'market.recent.title' })}
		</h3>
	{/if}

	<div class="space-y-4">
		{#if activities.length === 0}
			<p class="text-muted-foreground py-4 text-center text-xs">
				{t({ locale: $localeStore, key: 'market.recent.empty' })}
			</p>
		{:else}
			{#each activities as activity (activity.timestamp + activity.user)}
				<div class="flex items-start gap-3">
					<div
						class="bg-foreground/5 text-foreground/70 flex h-8 w-8 items-center justify-center rounded-full font-mono text-xs leading-none"
						aria-hidden="true"
					>
						{initialFor(activity.user)}
					</div>
					<div class="min-w-0 flex-1">
						<div class="flex items-center justify-between gap-2">
							<span
								class="text-foreground inline-flex min-w-0 items-center gap-1.5 text-xs font-bold"
							>
								<span class="truncate">{displayNameFor(activity.user)}</span>
								{#if $authPrincipal && activity.user === $authPrincipal}
									<YouBadge />
								{/if}
							</span>
							<span class="text-muted-foreground text-[10px] font-medium">
								{new Date(activity.timestamp).toLocaleTimeString([], {
									hour: '2-digit',
									minute: '2-digit'
								})}
							</span>
						</div>
						<p class="text-muted-foreground mt-0.5 text-[10px] leading-tight">
							<!-- A trade's `details` field carries the market question — redundant on the market's own page. -->
							{activity.type === ActivityType.TRADE
								? activity.title
								: (activity.details ?? activity.title)}
						</p>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>
