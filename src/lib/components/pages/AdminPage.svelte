<script lang="ts">
	import { ChevronRight, Vibrate } from '@lucide/svelte/icons';
	import { AppPath } from '#lib/constants/routes.constants.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { resolveAppPath } from '#lib/utils/nav.utils.ts';
	import { goto } from '$app/navigation';
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
				<span class="text-foreground block text-sm font-semibold">
					{t({ locale: $localeStore, key: 'admin.haptics.title' })}
				</span>
				<span class="text-muted-foreground block text-xs">
					{t({ locale: $localeStore, key: 'admin.diagnostics.haptics_description' })}
				</span>
			</span>
			<ChevronRight class="text-muted-foreground" aria-hidden="true" size={18} strokeWidth={1.8} />
		</button>
	</section>
</div>
