<script lang="ts">
	import YouBadge from '#lib/components/ui/YouBadge.svelte';
	import { authPrincipal } from '#lib/derived/user.derived.ts';
	import type { UserProfile } from '#lib/types/profile.ts';
	import type { Activity } from '#lib/types/social.ts';
	import { getActivityIcon } from '#lib/utils/activity.utils.ts';

	interface Props {
		activity: Activity;
		profile?: UserProfile;
	}

	const { activity, profile }: Props = $props();

	const isSelf = $derived(!!$authPrincipal && activity.user === $authPrincipal);
</script>

<div
	class="group bg-foreground/5 hover:bg-foreground/10 relative flex gap-3 rounded-2xl p-3 transition-all"
>
	<div
		class="bg-foreground/5 text-foreground/70 flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-sm leading-none"
		aria-hidden="true"
	>
		{getActivityIcon(activity.type)}
	</div>
	<div class="flex-1 overflow-hidden">
		<div class="flex items-center justify-between gap-2">
			<div class="flex min-w-0 items-center gap-1.5">
				<p class="group-hover:text-primary truncate text-sm font-semibold transition-colors">
					{profile?.nickname ?? 'Anonymous'}
				</p>
				{#if isSelf}
					<YouBadge />
				{/if}
			</div>
			<span class="text-muted-foreground shrink-0 text-[10px] opacity-50">
				{new Date(activity.timestamp).toLocaleTimeString([], {
					hour: '2-digit',
					minute: '2-digit'
				})}
			</span>
		</div>
		<p class="text-foreground/80 mb-1 text-xs font-medium">{activity.title}</p>
		{#if activity.details}
			<p class="text-muted-foreground line-clamp-2 text-[11px] italic opacity-70">
				"{activity.details}"
			</p>
		{/if}
	</div>
</div>
