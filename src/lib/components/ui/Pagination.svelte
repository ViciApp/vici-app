<script lang="ts">
	import { ChevronLeft, ChevronRight } from '@lucide/svelte/icons';
	import BaseButton from '#lib/components/ui/BaseButton.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		page: number;
		pageSize: number;
		totalItems: number;
		onPageChange: (page: number) => void;
		class?: string;
	}

	const { page, pageSize, totalItems, onPageChange, class: extraClass = '' }: Props = $props();

	const totalPages = $derived(Math.max(1, Math.ceil(totalItems / pageSize)));
	const safePage = $derived(Math.min(Math.max(1, page), totalPages));

	const rangeFrom = $derived(totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1);
	const rangeTo = $derived(Math.min(safePage * pageSize, totalItems));

	const canPrev = $derived(safePage > 1);
	const canNext = $derived(safePage < totalPages);

	// Build a compact page-number sequence with ellipses around the
	// current page. Keeps the control width bounded as `totalPages` grows.
	type Slot = number | 'ellipsis';
	const pageSlots = $derived.by((): Slot[] => {
		if (totalPages <= 7) {
			return Array.from({ length: totalPages }, (_, i) => i + 1);
		}

		const slots: Slot[] = [1];

		const windowStart = Math.max(2, safePage - 1);
		const windowEnd = Math.min(totalPages - 1, safePage + 1);

		if (windowStart > 2) {
			slots.push('ellipsis');
		}

		for (let p = windowStart; p <= windowEnd; p++) {
			slots.push(p);
		}

		if (windowEnd < totalPages - 1) {
			slots.push('ellipsis');
		}

		slots.push(totalPages);

		return slots;
	});

	const goTo = (target: number) => {
		const clamped = Math.min(Math.max(1, target), totalPages);

		if (clamped !== safePage) {
			onPageChange(clamped);
		}
	};
</script>

{#if totalItems > pageSize}
	<nav
		class="border-border bg-card flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-6 {extraClass}"
		aria-label={t({ locale: $localeStore, key: 'a11y.pagination' })}
	>
		<p class="text-muted-foreground text-[11px] font-bold tracking-wider uppercase tabular-nums">
			{t({
				locale: $localeStore,
				key: 'ui.pagination.range',
				params: { from: rangeFrom, to: rangeTo, total: totalItems }
			})}
		</p>

		<div class="flex items-center gap-1">
			<BaseButton
				class="border-border text-foreground hover:bg-foreground/5 inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold tracking-wider uppercase"
				aria-label={t({ locale: $localeStore, key: 'a11y.previous_page' })}
				onclick={() => goTo(safePage - 1)}
				status={canPrev ? 'enabled' : 'disabled'}
			>
				<ChevronLeft aria-hidden="true" size={14} strokeWidth={2.25} />
				<span class="hidden sm:inline"
					>{t({ locale: $localeStore, key: 'ui.pagination.previous' })}</span
				>
			</BaseButton>

			<!-- Compact page indicator below sm -->
			<span
				class="text-muted-foreground px-2 font-mono text-[11px] font-bold tracking-wider tabular-nums sm:hidden"
			>
				{t({
					locale: $localeStore,
					key: 'a11y.page_n',
					params: { page: safePage }
				})} / {totalPages}
			</span>

			<!-- Full page list from sm and up -->
			<ul class="hidden items-center gap-1 sm:flex">
				{#each pageSlots as slot, idx (idx)}
					{#if slot === 'ellipsis'}
						<li
							class="text-muted-foreground px-1.5 font-mono text-[11px] font-bold tabular-nums select-none"
							aria-hidden="true"
						>
							…
						</li>
					{:else}
						<li>
							<BaseButton
								class={[
									'inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 font-mono text-[11px] font-bold tabular-nums transition-colors',
									slot === safePage
										? 'bg-primary text-primary-foreground'
										: 'text-foreground hover:bg-foreground/5'
								].join(' ')}
								aria-current={slot === safePage ? 'page' : undefined}
								aria-label={t({
									locale: $localeStore,
									key: 'a11y.page_n',
									params: { page: slot }
								})}
								onclick={() => goTo(slot)}
							>
								{slot}
							</BaseButton>
						</li>
					{/if}
				{/each}
			</ul>

			<BaseButton
				class="border-border text-foreground hover:bg-foreground/5 inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold tracking-wider uppercase"
				aria-label={t({ locale: $localeStore, key: 'a11y.next_page' })}
				onclick={() => goTo(safePage + 1)}
				status={canNext ? 'enabled' : 'disabled'}
			>
				<span class="hidden sm:inline"
					>{t({ locale: $localeStore, key: 'ui.pagination.next' })}</span
				>
				<ChevronRight aria-hidden="true" size={14} strokeWidth={2.25} />
			</BaseButton>
		</div>
	</nav>
{/if}
