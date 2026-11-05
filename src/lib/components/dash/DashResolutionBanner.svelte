<script lang="ts">
	/**
	 * Resolution banner · while-you-were-away. Leads the standard dashboard
	 * when calls settled since the user last acknowledged them. Tapping
	 * opens the ResolutionReveal overlay. `is-neg` flips the accent to
	 * measured (no laurel / pulse) on a net-negative batch — the system
	 * never borrows celebratory styling for a loss. Class names live in
	 * `app.css`.
	 */
	import { localeStore } from '#lib/stores/locale.store.ts';
	import type { ResolutionRevealData } from '#lib/types/flow.ts';
	import { t } from '#lib/utils/i18n.utils.ts';
	import { formatWholeVxpMagnitude } from '#lib/utils/playground-display.utils.ts';

	interface Props {
		digest: ResolutionRevealData;
		onOpen: () => void;
	}

	let { digest, onOpen }: Props = $props();
</script>

<button class="dash-reso-banner" class:is-neg={digest.netVxp < 0} onclick={onOpen} type="button">
	<span class="dash-reso-dot" aria-hidden="true"></span>
	<span class="dash-reso-text">
		<span class="dash-reso-title">
			{t({
				locale: $localeStore,
				key: digest.count === 1 ? 'dash.reso.banner_title_one' : 'dash.reso.banner_title_many',
				params: { count: digest.count }
			})}
		</span>
		<span class="dash-reso-sub">
			<span
				class="dash-reso-vxp"
				class:is-neg={digest.netVxp < 0}
				class:is-pos={digest.netVxp >= 0}
			>
				{digest.netVxp >= 0 ? '+' : '−'}{formatWholeVxpMagnitude(digest.netVxp)}
				{t({ locale: $localeStore, key: 'flow.reso.vxp' })}
			</span>
			<span class="dash-reso-dim">
				{t({
					locale: $localeStore,
					key: 'dash.reso.banner_breakdown',
					params: { wins: digest.wins, losses: digest.losses }
				})}
			</span>
		</span>
	</span>
	<span class="dash-reso-cta">{t({ locale: $localeStore, key: 'dash.reso.banner_cta' })}</span>
</button>
