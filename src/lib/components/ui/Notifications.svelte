<script lang="ts">
	import { Check, X } from '@lucide/svelte';
	import { fade } from 'svelte/transition';
	import { notificationsStore } from '#lib/stores/notification.store.ts';

	const remove = (id: string) => notificationsStore.remove(id);
</script>

<div
	class="pointer-events-none fixed bottom-8 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4"
>
	{#each $notificationsStore as notification (notification.id)}
		<button
			class="bg-card ring-border shadow-toast vici-toast pointer-events-auto flex w-full items-start gap-3 rounded-2xl p-4 text-left ring-1"
			onclick={() => remove(notification.id)}
			out:fade={{ duration: 200 }}
		>
			{#if notification.type === 'error'}
				<div
					class="bg-danger-wash text-danger mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
				>
					<X size={12} strokeWidth={3} />
				</div>
			{:else}
				<div
					class="bg-yes-wash text-yes mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
				>
					<Check size={12} strokeWidth={3} />
				</div>
			{/if}
			<div class="flex flex-col">
				<span class="text-foreground text-sm font-black">{notification.title}</span>
				<p class="text-muted-foreground text-xs">{notification.message}</p>
			</div>
		</button>
	{/each}
</div>

<style lang="postcss">
	/* Entrance envelope. The shared `toast-in` keyframe uses
	   `translateX(-50%)` for the singleton centred toast; our
	   notifications stack inside an already-centred column, so we
	   apply the matching `fade-up` keyframe (same 8 px lift, same
	   timing) without re-translating each button. */
	.vici-toast {
		animation: fade-up 280ms var(--ease-stage) both;
	}

	@media (prefers-reduced-motion: reduce) {
		.vici-toast {
			animation: none;
		}
	}
</style>
