<script lang="ts">
	import { Sparkles } from '@lucide/svelte/icons';
	import { localeStore } from '#lib/stores/locale.store.ts';
	import { t } from '#lib/utils/i18n.utils.ts';

	interface Props {
		/**
		 * Compact rendering — small icon + tighter spacing. Used inside
		 * the FlowCard meta row where vertical rhythm is tight. Default
		 * (`false`) matches the OutcomeBadge / Badge proportions on
		 * `MarketCard`, so the chip sits on the same baseline as the
		 * status / outcome / challenge / multiple / closed-circle pills.
		 */
		compact?: boolean;
	}

	const { compact = false }: Props = $props();
</script>

<span
	style="letter-spacing: 0.08em;"
	class="suggested-chip inline-flex items-center gap-1 rounded-full border font-bold uppercase"
	class:compact
	title={t({ locale: $localeStore, key: 'market.metadata.suggested_help' })}
>
	<Sparkles aria-hidden="true" size={compact ? 10 : 12} />
	<span>{t({ locale: $localeStore, key: 'market.metadata.suggested' })}</span>
</span>

<style lang="postcss">
	.suggested-chip {
		padding: 0.25rem 0.55rem;
		border-color: color-mix(in srgb, var(--laurel) 35%, transparent);
		background: var(--laurel-glow);
		color: var(--laurel);
		font-size: var(--t-11);
	}

	.suggested-chip.compact {
		padding: 0.15rem 0.4rem;
		font-size: var(--t-10);
	}
</style>
