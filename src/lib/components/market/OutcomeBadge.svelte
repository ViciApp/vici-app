<script lang="ts">
	import { isNullish } from '@dfinity/utils';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { Outcome } from '#lib/types/market.ts';
	import { t, type MessageKey } from '#lib/utils/i18n.utils.ts';
	import { getOutcomeVariant } from '#lib/utils/market.utils.ts';

	interface Props {
		outcome?: Outcome | string;
		status?: string;
	}

	const { outcome, status }: Props = $props();

	const label = $derived(outcome ?? status ?? 'Unknown');

	const variant = $derived(getOutcomeVariant(label));

	const labelKey = $derived.by<MessageKey | undefined>(() => {
		switch (label) {
			case 'YES':
				return 'outcome.yes';
			case 'NO':
				return 'outcome.no';
			case 'CANCELED':
				return 'outcome.canceled';
			case 'Open':
				return 'status.open';
			case 'Resolved':
				return 'status.resolved';
			case 'Expired':
				return 'status.expired';
			case 'Unknown':
				return 'status.unknown';
		}
	});

	const displayLabel = $derived(
		isNullish(labelKey) ? label : t({ locale: $localeStore, key: labelKey })
	);
</script>

<Badge {variant}>
	{displayLabel}
</Badge>
