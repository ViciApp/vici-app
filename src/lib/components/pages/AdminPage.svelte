<script lang="ts">
	import {
		ChevronRight,
		Coins,
		Gavel,
		TrendingUp,
		UsersRound,
		Vibrate
	} from '@lucide/svelte/icons';
	import { onMount } from 'svelte';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
	import { markets } from '#lib/derived/markets.derived.ts';
	import { vxpFree } from '#lib/derived/vxp-holdings.derived.ts';
	import { listRoles, type UserRoleEntry } from '#lib/services/roles.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { formatVxpBalance } from '#lib/utils/playground-display.utils.ts';
	import { goto } from '$app/navigation';

	type HubPath =
		AppPath.AdminAccess | AppPath.AdminMarkets | AppPath.AdminResolutions | AppPath.AdminVxp;
	type HubIcon = typeof UsersRound | typeof TrendingUp | typeof Gavel | typeof Coins;

	interface Tile {
		path: HubPath;
		icon: HubIcon;
		titleKey: MessageKey;
		descriptionKey: MessageKey;
		countKey: MessageKey;
		count: number | string;
	}

	let roleEntries = $state<UserRoleEntry[]>([]);

	onMount(async () => {
		try {
			roleEntries = await listRoles();
		} catch (e: unknown) {
			console.error('Failed to fetch roles:', e);
		}
	});

	const rolesCount = $derived(roleEntries.length);
	const marketsCount = $derived($markets.length);
	const unresolvedCount = $derived($markets.filter((m) => m.status !== 'Resolved').length);
	const vxpBalanceDisplay = $derived(
		formatVxpBalance({ value: $vxpFree, decimals: VXP_TOKEN.decimals })
	);

	const tiles: Tile[] = $derived([
		{
			path: AppPath.AdminAccess,
			icon: UsersRound,
			titleKey: 'admin.hub.access.title',
			descriptionKey: 'admin.hub.access.description',
			countKey: 'admin.hub.access.count',
			count: rolesCount
		},
		{
			path: AppPath.AdminMarkets,
			icon: TrendingUp,
			titleKey: 'admin.hub.markets.title',
			descriptionKey: 'admin.hub.markets.description',
			countKey: 'admin.hub.markets.count',
			count: marketsCount
		},
		{
			path: AppPath.AdminResolutions,
			icon: Gavel,
			titleKey: 'admin.hub.resolutions.title',
			descriptionKey: 'admin.hub.resolutions.description',
			countKey: 'admin.hub.resolutions.count',
			count: unresolvedCount
		},
		{
			path: AppPath.AdminVxp,
			icon: Coins,
			titleKey: 'admin.hub.vxp.title',
			descriptionKey: 'admin.hub.vxp.description',
			countKey: 'admin.hub.vxp.count',
			count: vxpBalanceDisplay
		}
	]);
</script>

<div class="space-y-12 px-4 py-6 sm:py-8 lg:py-10">
	<header class="space-y-4">
		<h1 class="font-display text-foreground text-4xl font-semibold tracking-tight sm:text-5xl">
			{t({ locale: $localeStore, key: 'admin.dashboard.title' })}
		</h1>
		<p class="text-muted-foreground max-w-2xl text-lg">
			{t({ locale: $localeStore, key: 'admin.dashboard.sub' })}
		</p>
	</header>

	<ul class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
		{#each tiles as tile (tile.path)}
			{@const Icon = tile.icon}
			<li>
				<button
					class="border-border bg-card hover:border-primary/40 hover:bg-card/80 group flex h-full w-full flex-col items-start gap-5 rounded-3xl border p-7 text-left transition-all"
					onclick={() => goto(resolveAppPath(tile.path))}
					type="button"
				>
					<span
						class="bg-primary/10 text-primary group-hover:bg-primary/15 flex h-12 w-12 items-center justify-center rounded-2xl transition-colors"
						aria-hidden="true"
					>
						<Icon size={22} strokeWidth={1.8} />
					</span>

					<div class="flex-1 space-y-2">
						<h2 class="text-foreground text-2xl font-semibold tracking-tight">
							{t({ locale: $localeStore, key: tile.titleKey })}
						</h2>
						<p class="text-muted-foreground text-sm leading-relaxed">
							{t({ locale: $localeStore, key: tile.descriptionKey })}
						</p>
					</div>

					<div class="flex w-full items-center justify-between">
						<span
							class="bg-foreground/5 text-foreground/80 rounded-full px-3 py-1 font-mono text-xs font-semibold tabular-nums"
						>
							{t({
								locale: $localeStore,
								key: tile.countKey,
								params: { count: tile.count }
							})}
						</span>
						<ChevronRight
							class="text-muted-foreground group-hover:text-primary transition-colors"
							aria-hidden="true"
							size={18}
							strokeWidth={1.8}
						/>
					</div>
				</button>
			</li>
		{/each}
	</ul>

	<section class="space-y-3">
		<h2 class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
			{t({ locale: $localeStore, key: 'admin.diagnostics.title' })}
		</h2>
		<button
			class="border-border bg-card hover:border-primary/40 hover:bg-card/80 flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all"
			onclick={() => goto(resolveAppPath(AppPath.AdminHaptics))}
			type="button"
		>
			<span
				class="bg-primary/10 text-primary flex h-10 w-10 items-center justify-center rounded-xl"
				aria-hidden="true"
			>
				<Vibrate size={18} strokeWidth={1.8} />
			</span>
			<span class="flex-1">
				<span class="text-foreground block text-sm font-semibold"
					>{t({ locale: $localeStore, key: 'admin.haptics.title' })}</span
				>
				<span class="text-muted-foreground block text-xs"
					>{t({ locale: $localeStore, key: 'admin.diagnostics.haptics_description' })}</span
				>
			</span>
			<ChevronRight class="text-muted-foreground" aria-hidden="true" size={18} strokeWidth={1.8} />
		</button>
	</section>
</div>
