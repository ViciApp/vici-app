<script lang="ts">
	import { X } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import BaseButton from '#lib/components/ui/BaseButton.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		isOpen: boolean;
		children: Snippet;
		onClose: () => void;
	}

	const { isOpen, children, onClose }: Props = $props();

	const close = () => {
		onClose();
	};

	const handleKeyDown = (event: KeyboardEvent) => {
		if (isOpen && event.key === 'Escape') {
			close();
		}
	};
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-[8px]"
		role="presentation"
	>
		<BaseButton
			class="fixed inset-0 bg-black/55! opacity-100!"
			aria-label={t({ locale: $localeStore, key: 'a11y.close_modal' })}
			onclick={close}
		>
			<span class="sr-only">{t({ locale: $localeStore, key: 'a11y.close' })}</span>
		</BaseButton>

		<div
			class="animate-in fade-in zoom-in wrapper bg-popover border-border-strong shadow-modal relative flex w-full max-w-md flex-col overflow-hidden rounded-[12px] border duration-200"
			aria-modal="true"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			tabindex="-1"
		>
			<div class="header relative flex items-center justify-between gap-4 p-4 pb-0">
				<div class="flex flex-1 items-center justify-end gap-2">
					<button
						class="text-muted-foreground hover:bg-foreground/6 hover:text-foreground rounded-full p-2 transition-colors"
						aria-label={t({ locale: $localeStore, key: 'a11y.close' })}
						onclick={close}
						type="button"
					>
						<X size={24} />
					</button>
				</div>
			</div>

			<div class="content text-foreground flex-1 overflow-y-auto p-8 pt-4">
				{@render children()}
			</div>
		</div>
	</div>
{/if}

<style lang="postcss">
	:global(body:has(.wrapper)) {
		overflow: hidden;
	}

	/* `dvh`, not `vh`: on iOS `vh` is the large layout viewport (toolbars
	 * retracted), so a `90vh` panel can overflow the visible area. `90dvh`
	 * tracks the currently-visible height. This supersedes the old
	 * `-webkit-fill-available` iOS workaround. */
	.wrapper {
		max-height: 90vh; /* fallback for engines without `dvh` */
		max-height: 90dvh;
	}
</style>
