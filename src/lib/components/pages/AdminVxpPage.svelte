<script lang="ts">
	import { isNullish, nonNullish } from '@dfinity/utils';
	import { onMount } from 'svelte';
	import AdminSubPageHeader from '#lib/components/admin/AdminSubPageHeader.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Tabs from '#lib/components/ui/Tabs.svelte';
	import WalletHistoryPanel from '#lib/components/wallet/WalletHistoryPanel.svelte';
	import WalletReceive from '#lib/components/wallet/WalletReceive.svelte';
	import WalletSend from '#lib/components/wallet/WalletSend.svelte';
	import { VXP_TOKEN } from '#lib/constants/tokens/tokens.ic.constants.ts';
	import { walletUiTokens } from '#lib/derived/tokens.derived.ts';
	import { safeGetIdentityOnce } from '#lib/services/identity.services.ts';
	import { sendIc } from '#lib/services/send.services.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { notificationsStore } from '#lib/stores/notification.store.ts';
	import { WalletHistoryPager } from '#lib/stores/wallet-history-pager.svelte.ts';
	import type { Token } from '#lib/types/token.ts';
	import { emit } from '#lib/utils/events.utils.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { parseToken } from '#lib/utils/parse.utils.ts';

	/**
	 * Admin-only VXP treasury console: the send / receive / history
	 * surfaces over the VXP ledger, reachable from the admin hub.
	 *
	 * History pages the VXP index canister only; the ICP / ckUSDC legs
	 * start as `done` so `getTransactionsPage` never queries them.
	 */

	const pager = new WalletHistoryPager({
		initialDone: () => ({ icp: true, ckUsdc: true, vxp: false })
	});

	let activeTab = $state('send');

	const tabs = $derived([
		{ value: 'history', label: t({ locale: $localeStore, key: 'wallet.tab.history' }) },
		{ value: 'send', label: t({ locale: $localeStore, key: 'wallet.tab.send' }) },
		{ value: 'receive', label: t({ locale: $localeStore, key: 'wallet.tab.receive' }) }
	]);

	onMount(() => {
		void pager.reload();
	});

	let recipient = $state('');
	let amount = $state('');
	let selectedToken = $state<Token | undefined>();
	let sending = $state(false);

	// Send defaults to the VXP ledger; the clearing-driven wallet token
	// list still backs the selector, the constant only covers a cold load.
	const vxpUiToken = $derived(
		$walletUiTokens.find((token) => token.symbol === VXP_TOKEN.symbol) ?? VXP_TOKEN
	);
	const selectedTokenForSend = $derived(selectedToken ?? vxpUiToken);

	const handleSend = async () => {
		if (sending) {
			return;
		}

		if (isNullish(recipient) || isNullish(amount) || isNullish(selectedTokenForSend)) {
			return;
		}

		sending = true;

		try {
			const identity = await safeGetIdentityOnce();

			await sendIc({
				identity,
				to: recipient,
				amount: parseToken({
					value: `${amount}`,
					unitName: selectedTokenForSend.decimals
				}),
				ledgerCanisterId: selectedTokenForSend.ledgerCanisterId
			});

			emit({ message: 'viciRefreshBalances' });

			await pager.reload();

			amount = '';

			recipient = '';

			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'wallet.send.success_title' }),
				message: t({ locale: $localeStore, key: 'wallet.send.success_message' }),
				type: 'success'
			});
		} catch (e: unknown) {
			notificationsStore.add({
				title: t({ locale: $localeStore, key: 'wallet.send.error_title' }),
				message: (e as Error).message,
				type: 'error'
			});
		} finally {
			sending = false;
		}
	};
</script>

<div class="space-y-12 px-4 py-6 sm:py-8 lg:py-10">
	<AdminSubPageHeader
		description={t({ locale: $localeStore, key: 'admin.hub.vxp.description' })}
		title={t({ locale: $localeStore, key: 'admin.hub.vxp.title' })}
	/>

	<Card class="bg-card/85 overflow-hidden" padding="none">
		<div class="border-border border-b p-2">
			<Tabs {tabs} bind:activeTab />
		</div>

		<div class="w-full p-4 sm:p-6">
			{#if activeTab === 'send'}
				{#if nonNullish(selectedTokenForSend)}
					<WalletSend
						{amount}
						onAmountChange={(v) => (amount = v)}
						onRecipientChange={(v) => (recipient = v)}
						onSend={handleSend}
						onTokenChange={(v) => (selectedToken = v)}
						{recipient}
						selectedToken={selectedTokenForSend}
						sendStatus={sending ? 'pending' : 'enabled'}
						tokens={$walletUiTokens}
					/>
				{:else}
					<p class="text-muted-foreground text-sm">
						{t({ locale: $localeStore, key: 'wallet.send.empty' })}
					</p>
				{/if}
			{:else if activeTab === 'receive'}
				<WalletReceive />
			{:else if activeTab === 'history'}
				<WalletHistoryPanel {pager} transactions={pager.transactions} />
			{/if}
		</div>
	</Card>
</div>
