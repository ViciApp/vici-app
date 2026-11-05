<script lang="ts">
	import { onMount } from 'svelte';
	import Avatar from '#lib/components/profile/Avatar.svelte';
	import BaseButton from '#lib/components/ui/BaseButton.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import LoadingSpinner from '#lib/components/ui/LoadingSpinner.svelte';
	import YouBadge from '#lib/components/ui/YouBadge.svelte';
	import { ActivityType } from '#lib/enums/social.ts';
	import { logActivity } from '#lib/services/activity.services.ts';
	import {
		addComment,
		downvoteComment,
		loadMarketComments,
		upvoteComment
	} from '#lib/services/discussion.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { marketCommentsStore } from '#lib/stores/market-comments.store.ts';
	import { profilesStore } from '#lib/stores/profiles.store.ts';
	import type { Comment } from '#lib/types/comment.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { refreshGlobalActivities } from '#lib/utils/refresh.utils.ts';

	interface Props {
		marketId: string;
		userPrincipal: string;
	}

	const { marketId, userPrincipal }: Props = $props();

	// Comments are cached per-market in `marketCommentsStore` so navigating
	// away and back renders the previous comments instantly while a fresh
	// fetch runs in the background. `Map.has(marketId)` doubles as the
	// "loaded at least once" flag.
	const comments = $derived($marketCommentsStore.get(marketId) ?? []);
	const loading = $derived(!$marketCommentsStore.has(marketId));

	let newComment = $state('');
	let posting = $state(false);
	let voting = $state<Record<string, boolean>>({});

	onMount(() => {
		void loadMarketComments({ marketId });
	});

	const handlePostComment = async () => {
		if (!newComment.trim() || posting) {
			return;
		}

		posting = true;

		try {
			await addComment({
				marketId,
				user: userPrincipal,
				content: newComment.trim()
			});

			await logActivity({
				type: ActivityType.COMMENT,
				user: userPrincipal,
				marketId,
				title: t({ locale: $localeStore, key: 'arena.discussion.activity.new_comment' }),
				details: newComment.trim().slice(0, 50) + (newComment.length > 50 ? '...' : '')
			});

			newComment = '';
			await loadMarketComments({ marketId });
			// Logged activity → global feed is now stale; refresh it so
			// the Leaderboard "Activity" tab and `MarketRecentTrades`
			// reflect this comment without waiting for the slow poll.
			refreshGlobalActivities();
		} finally {
			posting = false;
		}
	};

	const handleVote = async ({ comment, type }: { comment: Comment; type: 'up' | 'down' }) => {
		if (voting[comment.key]) {
			return;
		}

		voting[comment.key] = true;

		try {
			if (type === 'up') {
				const isRemoval = comment.upvotes?.includes(userPrincipal);
				await upvoteComment({ commentKey: comment.key, userPrincipal });

				if (!isRemoval) {
					await logActivity({
						type: ActivityType.UPVOTE,
						user: userPrincipal,
						marketId,
						title: t({ locale: $localeStore, key: 'arena.discussion.activity.upvoted' }),
						details: comment.content.slice(0, 30) + (comment.content.length > 30 ? '...' : '')
					});
				}
			} else {
				const isRemoval = comment.downvotes?.includes(userPrincipal);
				await downvoteComment({ commentKey: comment.key, userPrincipal });

				if (!isRemoval) {
					await logActivity({
						type: ActivityType.DOWNVOTE,
						user: userPrincipal,
						marketId,
						title: t({ locale: $localeStore, key: 'arena.discussion.activity.downvoted' }),
						details: comment.content.slice(0, 30) + (comment.content.length > 30 ? '...' : '')
					});
				}
			}

			await loadMarketComments({ marketId });
			refreshGlobalActivities();
		} finally {
			voting[comment.key] = false;
		}
	};
</script>

<div class="flex flex-col gap-6">
	<div class="glassmorphism rounded-2xl p-4">
		<textarea
			class="border-border bg-background/50 focus:ring-primary/50 w-full resize-none rounded-xl border p-4 text-sm focus:ring-2 focus:outline-none"
			placeholder={t({ locale: $localeStore, key: 'arena.discussion.input.placeholder' })}
			rows="3"
			bind:value={newComment}></textarea>
		<div class="mt-3 flex justify-end">
			<Button
				onclick={handlePostComment}
				status={posting ? 'pending' : !newComment.trim() ? 'disabled' : 'enabled'}
			>
				{#snippet busyLabel()}{t({
						locale: $localeStore,
						key: 'arena.discussion.action.posting'
					})}{/snippet}
				{t({ locale: $localeStore, key: 'arena.discussion.action.post' })}
			</Button>
		</div>
	</div>

	<div class="flex flex-col gap-4">
		{#if loading}
			<div class="flex justify-center py-8">
				<LoadingSpinner inlinePad />
			</div>
		{:else if comments.length === 0}
			<div class="py-12 text-center opacity-40">
				<p class="text-sm italic">
					{t({ locale: $localeStore, key: 'arena.discussion.empty' })}
				</p>
			</div>
		{:else}
			{#each comments as comment (comment.key)}
				{@const profile = $profilesStore.get(comment.user)}
				{@const upvoted = comment.upvotes?.includes(userPrincipal)}
				{@const downvoted = comment.downvotes?.includes(userPrincipal)}
				{@const score = (comment.upvotes?.length ?? 0) - (comment.downvotes?.length ?? 0)}

				<div
					class="bg-card/20 border-border/50 animate-in fade-in slide-in-from-bottom-2 flex gap-4 rounded-2xl border p-4 duration-300"
				>
					<div class="flex flex-col items-center gap-1">
						<BaseButton
							class="hover:bg-primary/10 flex h-8 w-8 items-center justify-center rounded-lg transition-colors {upvoted
								? 'text-primary'
								: 'opacity-40 hover:opacity-100'}"
							aria-label={t({ locale: $localeStore, key: 'arena.discussion.action.upvote' })}
							onclick={() => handleVote({ comment, type: 'up' })}
							status={voting[comment.key] ? 'pending' : 'enabled'}
						>
							<svg
								fill="none"
								height="20"
								stroke="currentColor"
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2.5"
								viewBox="0 0 24 24"
								width="20"
								xmlns="http://www.w3.org/2000/svg"
								><path d="m18 15-6-6-6 6" />
							</svg>
						</BaseButton>

						<span
							class="text-xs font-bold {score > 0
								? 'text-primary'
								: score < 0
									? 'text-red-500'
									: 'opacity-40'}"
						>
							{score > 0 ? `+${score}` : score}
						</span>

						<BaseButton
							class="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-red-500/10 {downvoted
								? 'text-red-500'
								: 'opacity-40 hover:opacity-100'}"
							aria-label={t({ locale: $localeStore, key: 'arena.discussion.action.downvote' })}
							onclick={() => handleVote({ comment, type: 'down' })}
							status={voting[comment.key] ? 'pending' : 'enabled'}
						>
							<svg
								fill="none"
								height="20"
								stroke="currentColor"
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2.5"
								viewBox="0 0 24 24"
								width="20"
								xmlns="http://www.w3.org/2000/svg"
							>
								<path d="m6 9 6 6 6-6" />
							</svg>
						</BaseButton>
					</div>

					<div class="flex-1 overflow-hidden">
						<div class="mb-1 flex items-start justify-between">
							<div class="flex items-center gap-2">
								<Avatar
									class="bg-muted h-6 w-6 shrink-0"
									avatar={profile?.avatar}
									avatarParts={profile?.avatarParts}
									nickname={profile?.nickname}
									owner={profile?.owner ?? comment.user}
								/>
								<span class="text-sm font-bold">
									{profile?.nickname ??
										t({ locale: $localeStore, key: 'arena.discussion.anonymous' })}
								</span>
								{#if comment.user === userPrincipal}
									<YouBadge />
								{/if}
								<span class="text-muted-foreground text-[10px] opacity-50">
									{new Date(comment.timestamp).toLocaleString()}
								</span>
							</div>
						</div>
						<p class="text-sm leading-relaxed whitespace-pre-wrap">{comment.content}</p>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>

<style lang="postcss">
	.glassmorphism {
		background: rgba(255, 255, 255, 0.03);
		backdrop-filter: blur(10px);
		border: 1px solid rgba(255, 255, 255, 0.05);
	}
</style>
