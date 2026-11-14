<script lang="ts">
	import type { PrincipalText } from '@junobuild/schema';
	import Button from '#lib/components/ui/Button.svelte';
	import CopyableAddress from '#lib/components/ui/CopyableAddress.svelte';
	import { searchProfiles } from '#lib/services/profile.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { UserProfile } from '#lib/types/profile.ts';
	import { shortenWithMiddleEllipsis } from '#lib/utils/format.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		// Called when an admin picks a result: used to prefill the
		// Assign Role principal field below.
		onSelect: (principal: PrincipalText) => void;
	}

	const { onSelect }: Props = $props();

	const SEARCH_DEBOUNCE_MS = 300;

	let query = $state('');
	let results = $state<UserProfile[]>([]);
	let status = $state<'idle' | 'searching' | 'done' | 'error'>('idle');

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	// Monotonic token drops stale responses when the input changes mid-flight.
	let searchToken = 0;

	// Debounced live search over nickname / owner / key via the secure
	// satellite query (`searchProfiles`). A monotonic token cancels the
	// in-flight request on each keystroke so a slow earlier response can't
	// clobber a newer one.
	$effect(() => {
		const candidate = query.trim();

		if (searchTimer) {
			clearTimeout(searchTimer);
		}

		searchToken += 1;
		const token = searchToken;

		if (candidate === '') {
			results = [];
			status = 'idle';

			return;
		}

		status = 'searching';

		searchTimer = setTimeout(() => {
			void (async () => {
				try {
					const items = await searchProfiles(candidate);

					if (token !== searchToken) {
						return;
					}

					results = items;
					status = 'done';
				} catch (err) {
					if (token !== searchToken) {
						return;
					}

					console.error(`Admin principal search failed for "${candidate}":`, err);
					results = [];
					status = 'error';
				}
			})();
		}, SEARCH_DEBOUNCE_MS);

		return () => {
			if (searchTimer) {
				clearTimeout(searchTimer);
			}
		};
	});
</script>

<div class="border-border bg-card rounded-xl border p-6">
	<h2 class="text-foreground mb-6 text-xl font-semibold">
		{t({ locale: $localeStore, key: 'admin.roles.search.title' })}
	</h2>

	<div>
		<label class="text-foreground block text-sm font-medium" for="admin-principal-search">
			{t({ locale: $localeStore, key: 'admin.roles.search.label' })}
		</label>
		<div class="mt-2">
			<input
				id="admin-principal-search"
				class="focus:ring-brand-600 text-foreground ring-border placeholder:text-muted-foreground focus:ring-primary block w-full rounded-md border-0 py-1.5 ring-1 ring-inset focus:ring-2 focus:ring-inset sm:text-sm sm:leading-6"
				autocomplete="off"
				oninput={(e) => (query = e.currentTarget.value)}
				placeholder={t({ locale: $localeStore, key: 'admin.roles.search.placeholder' })}
				type="text"
				value={query}
			/>
		</div>
		<div class="text-muted-foreground mt-2 text-sm">
			{t({ locale: $localeStore, key: 'admin.roles.search.hint' })}
		</div>
	</div>

	{#if status === 'searching'}
		<p class="text-muted-foreground mt-4 text-sm">
			{t({ locale: $localeStore, key: 'admin.roles.search.searching' })}
		</p>
	{:else if status === 'error'}
		<p class="text-destructive mt-4 text-sm">
			{t({ locale: $localeStore, key: 'common.error.generic' })}
		</p>
	{:else if status === 'done' && results.length === 0}
		<p class="text-muted-foreground mt-4 text-sm">
			{t({ locale: $localeStore, key: 'admin.roles.search.empty' })}
		</p>
	{:else if results.length > 0}
		<ul class="divide-border border-border mt-4 divide-y overflow-hidden rounded-md border">
			{#each results as profile (profile.owner)}
				<li class="flex items-center justify-between gap-4 px-4 py-3">
					<div class="min-w-0">
						<span class="text-foreground block truncate text-sm font-semibold">
							{profile.nickname || shortenWithMiddleEllipsis({ text: profile.owner })}
						</span>
						<span class="text-muted-foreground text-sm">
							<CopyableAddress
								address={profile.owner}
								label={t({ locale: $localeStore, key: 'profile.dashboard.principal' })}
							/>
						</span>
					</div>
					<Button onclick={() => onSelect(profile.owner)} size="sm" variant="outline">
						{t({ locale: $localeStore, key: 'admin.roles.search.use' })}
					</Button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
