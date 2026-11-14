<script lang="ts">
	import { fade } from 'svelte/transition';
	import { clickOutside } from '#lib/actions/click-outside.ts';
	import Badge from '#lib/components/ui/Badge.svelte';
	import NestedButton from '#lib/components/ui/NestedButton.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { LeagueMemberRole } from '#lib/types/league-member.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { prefersReducedMotion } from '#lib/utils/reduced-motion.utils.ts';
	import { isMobileViewport } from '#lib/utils/viewport.utils.ts';

	interface Props {
		role: LeagueMemberRole;
		// Roomy contexts (e.g. the member detail sheet) opt out of the mobile
		// collapse and always spell the role out.
		expanded?: boolean;
	}

	const { role, expanded = false }: Props = $props();

	// Members are the default: a chip on every row would be noise, so only
	// owner/admin earn one. Owner takes the gold (laurel) tone to read as the
	// league's lead; admin stays neutral.

	const label = $derived(
		t({
			locale: $localeStore,
			key: role === 'owner' ? 'leagues.detail.role_owner' : 'leagues.detail.role_admin'
		})
	);

	// On the cramped mobile leaderboard rows the spelled-out chip crowds the
	// handle, so it collapses to its initial and reveals the full role in a tap
	// tooltip. Desktop (and the roomy member sheet) keep the word inline.
	const collapsed = $derived(isMobileViewport() && !expanded);
	// Codepoint-aware first character so a non-BMP / combined localized initial
	// doesn't split mid-grapheme.
	const initial = $derived([...label][0] ?? '');

	let showTooltip = $state(false);

	// Drop a left-open tooltip when the chip stops being collapsed (e.g. the
	// viewport widens past the breakpoint), so it can't reappear pre-opened.
	$effect(() => {
		if (!collapsed) {
			showTooltip = false;
		}
	});
</script>

{#if role === 'owner' || role === 'admin'}
	{#if collapsed}
		<span class="relative inline-flex" use:clickOutside={() => (showTooltip = false)}>
			<NestedButton
				class="focus-visible:ring-primary inline-flex rounded-full focus-visible:ring-2 focus-visible:outline-hidden"
				expanded={showTooltip}
				{label}
				onclick={() => (showTooltip = !showTooltip)}
			>
				<Badge size="xs" variant={role === 'owner' ? 'warning' : 'default'}>
					{initial}
				</Badge>
			</NestedButton>

			{#if showTooltip}
				<span
					class="bg-popover border-border-strong shadow-modal text-foreground absolute top-full left-1/2 z-50 mt-1 -translate-x-1/2 rounded-[6px] border px-2 py-1 text-[10px] font-semibold whitespace-nowrap backdrop-blur-md"
					role="tooltip"
					transition:fade={prefersReducedMotion() ? { duration: 0 } : { duration: 120 }}
				>
					{label}
				</span>
			{/if}
		</span>
	{:else}
		<Badge size="xs" variant={role === 'owner' ? 'warning' : 'default'}>
			{label}
		</Badge>
	{/if}
{/if}
