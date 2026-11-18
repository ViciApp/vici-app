<script lang="ts">
	import { nonNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import CopyableAddress from '#lib/components/ui/CopyableAddress.svelte';
	import { getReceiveAddress } from '#lib/services/wallet.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	// The service resolves the deposit target per backend: the signed-in
	// principal on-chain, the custodial IC principal in web2 mode. Both are IC
	// principals, so the copy below stays accurate.
	let principalText = $state<string | undefined>();

	onMount(async () => {
		principalText = await getReceiveAddress();
	});
</script>

<div class="flex flex-col items-center space-y-5 text-center">
	<div class="border-border bg-foreground/5 shadow-card rounded-2xl border p-4">
		<div class="bg-card/70 flex h-48 w-48 items-center justify-center rounded-xl">
			<span class="text-muted-foreground text-xs font-bold">
				{t({ locale: $localeStore, key: 'wallet.receive.qr_placeholder' })}
			</span>
		</div>
	</div>
	<div class="space-y-2">
		<p class="eyebrow">{t({ locale: $localeStore, key: 'wallet.receive.your_principal' })}</p>
		{#if nonNullish(principalText)}
			<div
				class="border-border bg-foreground/5 text-primary shadow-card flex items-center justify-center rounded-xl border px-4 py-2 text-sm"
			>
				<CopyableAddress
					address={principalText}
					label={t({ locale: $localeStore, key: 'wallet.receive.principal_label' })}
					showSelfIndicator={false}
				/>
			</div>
		{:else}
			<p class="text-muted-foreground text-sm italic">
				{t({ locale: $localeStore, key: 'wallet.receive.loading' })}
			</p>
		{/if}
	</div>
</div>
