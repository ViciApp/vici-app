<script lang="ts">
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { isDev } from '#lib/env/app.env.ts';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { ButtonStatus } from '#lib/types/components.ts';
	import type { Token } from '#lib/types/token.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		tokens: Token[];
		recipient: string;
		amount: string;
		selectedToken: Token | undefined;
		sendStatus?: ButtonStatus;
		onRecipientChange: (v: string) => void;
		onAmountChange: (v: string) => void;
		onTokenChange: (v: Token) => void;
		onSend: () => void;
	}

	const {
		tokens,
		recipient,
		amount,
		selectedToken,
		sendStatus = 'enabled',
		onRecipientChange,
		onAmountChange,
		onTokenChange,
		onSend
	}: Props = $props();

	const isSelected = (token: Token) => selectedToken?.ledgerCanisterId === token.ledgerCanisterId;
</script>

<div class="max-w-xl space-y-5">
	<div class="space-y-2">
		<span class="eyebrow">{t({ locale: $localeStore, key: 'wallet.send.token' })}</span>
		<div class="grid grid-cols-2 gap-2.5">
			{#each tokens as token (token.ledgerCanisterId)}
				<button
					class="shadow-card flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold transition-all {isSelected(
						token
					)
						? 'border-primary/45 bg-laurel-glow text-primary'
						: 'border-border bg-foreground/5 text-muted-foreground hover:border-border-strong hover:text-foreground'}"
					aria-pressed={isSelected(token)}
					onclick={() => onTokenChange(token)}
					type="button"
				>
					{token.symbol}
					{#if isDev() && token.isDevEnabled}
						<Badge size="sm" variant="warning">
							{t({ locale: $localeStore, key: 'wallet.badge.dev' })}
						</Badge>
					{/if}
				</button>
			{/each}
		</div>
	</div>

	<div class="space-y-2">
		<label class="eyebrow" for="recipient-principal">
			{t({ locale: $localeStore, key: 'wallet.send.recipient' })}
		</label>
		<input
			id="recipient-principal"
			class="bg-foreground/5 text-foreground ring-border focus:ring-primary w-full rounded-xl border-none px-4 py-3 text-sm ring-1 ring-inset focus:ring-2"
			oninput={(e) => onRecipientChange(e.currentTarget.value)}
			placeholder={t({ locale: $localeStore, key: 'wallet.send.recipient_placeholder' })}
			type="text"
			value={recipient}
		/>
	</div>

	<div class="space-y-2">
		<label class="eyebrow" for="send-amount">
			{t({ locale: $localeStore, key: 'wallet.send.amount' })}
		</label>
		<input
			id="send-amount"
			class="bg-foreground/5 text-foreground ring-border focus:ring-primary num w-full rounded-xl border-none px-4 py-3 ring-1 ring-inset focus:ring-2"
			oninput={(e) => onAmountChange(e.currentTarget.value)}
			placeholder="0.00"
			type="number"
			value={amount}
		/>
	</div>

	<Button class="w-full py-4 text-sm font-black" onclick={onSend} status={sendStatus}>
		{#snippet busyLabel()}{t({ locale: $localeStore, key: 'wallet.send.sending' })}{/snippet}
		{t({ locale: $localeStore, key: 'wallet.send.send_tokens' })}
	</Button>
</div>
