<script lang="ts">
	import Badge from '#lib/components/ui/Badge.svelte';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		label?: string;
		size?: 'xs' | 'sm';
	}

	const { label, size = 'xs' }: Props = $props();
</script>

<Badge {size} title={t({ locale: $localeStore, key: 'ui.you_badge.title' })} variant="primary">
	{label ?? t({ locale: $localeStore, key: 'ui.you_badge.label' })}
</Badge>
